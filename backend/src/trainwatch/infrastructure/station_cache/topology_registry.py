"""In-memory station topology registry and priority hierarchy classifier."""

from __future__ import annotations

import re
from collections.abc import Sequence

from trainwatch.domain.smart_routes import StationRole
from trainwatch.infrastructure.train_api.cdn_schedule import ScheduleStop

# National Major Hubs, Zonal Hubs, and Remote Quota (RL) Junctions
MAJOR_HUBS = frozenset(
    {
        # Southern & South Western
        "MAS", "MS", "MDU", "TPJ", "CBE", "SA", "ED", "SBC", "YPR", "SC",
        "HYB", "BZA", "RU", "GTL", "TVC", "ERS", "CAN", "CLT", "SRR", "UBL",
        "MYS", "GNT", "NED", "PGT", "VM", "TEN", "TCR", "QLN",
        # Central & Western
        "BPL", "ET", "NGP", "BSL", "MMR", "PUNE", "CSMT", "MMCT", "BDTS",
        "ADI", "BRC", "ST", "RTM", "KOTA", "SUR", "JBP", "RJT", "BVP",
        # Northern & North Central
        "NDLS", "DLI", "NZM", "CNB", "LKO", "GKP", "BSB", "DDU", "AGC",
        "GWL", "JHS", "UMB", "ASR", "CDG", "JP", "AII", "JU", "BKN",
        "PRYJ", "LJN", "MB", "FZR", "IZN",
        # Eastern, East Coast & North East
        "HWH", "SDAH", "KOAA", "KGP", "TATA", "ASN", "PNBE", "GHY", "NJP",
        "BBS", "PURI", "VSKP", "R", "BSP", "DNR", "DHN", "MLDT", "SEE",
        "SPJ", "ADRA", "CKP", "RNC", "KUR", "SBP", "WAT", "KIR", "APDJ",
    }
)

# Indian Railways 68 Division Headquarters
DIVISION_HQS = frozenset(
    {
        # Central Railway
        "CSMT", "BSL", "NGP", "PUNE", "SUR",
        # Eastern Railway
        "HWH", "SDAH", "ASN", "MLDT",
        # East Central Railway
        "DNR", "DHN", "DDU", "SEE", "SPJ",
        # East Coast Railway
        "KUR", "SBP", "WAT",
        # Northern Railway
        "DLI", "FZR", "LKO", "MB", "UMB",
        # North Central Railway
        "PRYJ", "AGC", "JHS",
        # North Eastern Railway
        "IZN", "LJN", "BSB",
        # Northeast Frontier Railway
        "APDJ", "KIR", "LMG", "RNY", "TSK",
        # North Western Railway
        "AII", "BKN", "JP", "JU",
        # Southern Railway
        "MAS", "MDU", "PGT", "SA", "TPJ", "TVC",
        # South Central Railway
        "SC", "HYB", "BZA", "GNT", "GTL", "NED",
        # South Eastern Railway
        "ADRA", "CKP", "KGP", "RNC",
        # South East Central Railway
        "BSP", "R",
        # South Western Railway
        "UBL", "SBC", "MYS",
        # Western Railway
        "MMCT", "BRC", "ADI", "RTM", "RJT", "BVP",
        # West Central Railway
        "JBP", "BPL", "KOTA",
    }
)

_JUNCTION_NAME_PATTERN = re.compile(r"\b(JN|JUNCTION)\b", re.IGNORECASE)


def classify_station(station_code: str, station_name: str = "") -> StationRole:
    """Classify station into hierarchical role.

    Priority hierarchy:
    1. MAJOR_HUB
    2. DIVISION_HQ
    3. JUNCTION
    4. ADJACENT_HALT
    """
    code = station_code.strip().upper()
    name = station_name.strip()

    if code in MAJOR_HUBS:
        return StationRole.MAJOR_HUB
    if code in DIVISION_HQS:
        return StationRole.DIVISION_HQ
    if _JUNCTION_NAME_PATTERN.search(name) or code.endswith("JN") or code.endswith("J"):
        return StationRole.JUNCTION
    return StationRole.ADJACENT_HALT


class StationTopologyRegistry:
    """Intelligent station selector and pruner for candidate berth splitting points."""

    @staticmethod
    def rank_candidate_stations(
        intermediate_stops: Sequence[ScheduleStop],
        *,
        max_candidates: int = 6,
    ) -> tuple[ScheduleStop, ...]:
        """Rank and select optimal intermediate candidate stations for berth splitting.

        Hierarchy rule:
        1. Major Hubs first.
        2. Divisional Headquarters next.
        3. Passenger Junctions third.
        4. Adjacent intermediate halts ONLY if fewer than 2 hubs/junctions exist.

        Stops are selected to give geographically distributed coverage along the journey.
        """
        if not intermediate_stops:
            return ()

        # Classify each intermediate stop
        tier1_hubs: list[ScheduleStop] = []
        tier2_divs: list[ScheduleStop] = []
        tier3_jns: list[ScheduleStop] = []
        tier4_adjacent: list[ScheduleStop] = []

        for stop in intermediate_stops:
            role = classify_station(stop.station_code, stop.station_name)
            if role == StationRole.MAJOR_HUB:
                tier1_hubs.append(stop)
            elif role == StationRole.DIVISION_HQ:
                tier2_divs.append(stop)
            elif role == StationRole.JUNCTION:
                tier3_jns.append(stop)
            else:
                tier4_adjacent.append(stop)

        # Collect candidates in priority hierarchy
        selected: list[ScheduleStop] = []

        for hub in tier1_hubs:
            if hub not in selected:
                selected.append(hub)

        if len(selected) < max_candidates:
            for div in tier2_divs:
                if div not in selected and len(selected) < max_candidates:
                    selected.append(div)

        if len(selected) < max_candidates:
            for jn in tier3_jns:
                if jn not in selected and len(selected) < max_candidates:
                    selected.append(jn)

        # Only fallback to adjacent halts if fewer than 2 candidates found
        if len(selected) < 2:
            for adj in tier4_adjacent:
                if adj not in selected and len(selected) < max_candidates:
                    selected.append(adj)

        # Re-sort selected candidates by their route order (stop_number or distance)
        selected.sort(key=lambda s: s.stop_number)
        return tuple(selected)
