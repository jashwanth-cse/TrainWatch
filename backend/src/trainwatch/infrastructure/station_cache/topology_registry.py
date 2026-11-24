"""In-memory station topology registry and priority hierarchy classifier.

Loads data from data/division_hubs.json and data/state_capitals.json at startup
with zero-allocation, lock-free O(1) in-memory frozenset lookups during requests.
"""

from __future__ import annotations

import json
import logging
import os
import re
from collections.abc import Sequence
from pathlib import Path

from trainwatch.domain.smart_routes import StationRole
from trainwatch.infrastructure.train_api.cdn_schedule import ScheduleStop

_LOGGER = logging.getLogger(__name__)

# Baseline National Major Hubs and Remote Quota (RL) Junctions
DEFAULT_MAJOR_HUBS = frozenset(
    {
        # Southern & South Western
        "MAS",
        "MS",
        "MDU",
        "TPJ",
        "CBE",
        "SA",
        "ED",
        "SBC",
        "YPR",
        "SC",
        "HYB",
        "BZA",
        "RU",
        "GTL",
        "TVC",
        "ERS",
        "CAN",
        "CLT",
        "SRR",
        "UBL",
        "MYS",
        "GNT",
        "NED",
        "PGT",
        "VM",
        "TEN",
        "TCR",
        "QLN",
        # Central & Western
        "BPL",
        "ET",
        "NGP",
        "BSL",
        "MMR",
        "PUNE",
        "CSMT",
        "MMCT",
        "BDTS",
        "ADI",
        "BRC",
        "ST",
        "RTM",
        "KOTA",
        "SUR",
        "JBP",
        "RJT",
        "BVP",
        # Northern & North Central
        "NDLS",
        "DLI",
        "NZM",
        "CNB",
        "LKO",
        "GKP",
        "BSB",
        "DDU",
        "AGC",
        "GWL",
        "JHS",
        "UMB",
        "ASR",
        "CDG",
        "JP",
        "AII",
        "JU",
        "BKN",
        "PRYJ",
        "LJN",
        "MB",
        "FZR",
        "IZN",
        # Eastern, East Coast & North East
        "HWH",
        "SDAH",
        "KOAA",
        "KGP",
        "TATA",
        "ASN",
        "PNBE",
        "GHY",
        "NJP",
        "BBS",
        "PURI",
        "VSKP",
        "R",
        "BSP",
        "DNR",
        "DHN",
        "MLDT",
        "SEE",
        "SPJ",
        "ADRA",
        "CKP",
        "RNC",
        "KUR",
        "SBP",
        "WAT",
        "KIR",
        "APDJ",
    }
)

# Indian Railways 68 Division Headquarters baseline
DEFAULT_DIVISION_HQS = frozenset(
    {
        "CSMT",
        "BSL",
        "NGP",
        "PUNE",
        "SUR",
        "HWH",
        "SDAH",
        "ASN",
        "MLDT",
        "DNR",
        "DHN",
        "DDU",
        "SEE",
        "SPJ",
        "KUR",
        "SBP",
        "WAT",
        "DLI",
        "FZR",
        "LKO",
        "MB",
        "UMB",
        "PRYJ",
        "AGC",
        "JHS",
        "IZN",
        "LJN",
        "BSB",
        "APDJ",
        "KIR",
        "LMG",
        "RNY",
        "TSK",
        "AII",
        "BKN",
        "JP",
        "JU",
        "MAS",
        "MDU",
        "PGT",
        "SA",
        "TPJ",
        "TVC",
        "SC",
        "HYB",
        "BZA",
        "GNT",
        "GTL",
        "NED",
        "ADRA",
        "CKP",
        "KGP",
        "RNC",
        "BSP",
        "R",
        "UBL",
        "SBC",
        "MYS",
        "MMCT",
        "BRC",
        "ADI",
        "RTM",
        "RJT",
        "BVP",
        "JBP",
        "BPL",
        "KOTA",
    }
)

# State and UT Capitals baseline
DEFAULT_STATE_CAPITALS = frozenset(
    {
        "AGTL",
        "BBS",
        "BHRB",
        "BPL",
        "BZA",
        "CDG",
        "CSMT",
        "DDN",
        "DMV",
        "ERS",
        "GHY",
        "GNC",
        "HWH",
        "JAT",
        "JP",
        "JRBM",
        "LKO",
        "MAO",
        "MAS",
        "MNDP",
        "NDLS",
        "NHLN",
        "NJP",
        "PDY",
        "PNBE",
        "R",
        "RNC",
        "SBC",
        "SC",
        "SML",
        "TVC",
        "VAPI",
    }
)

_JUNCTION_NAME_PATTERN = re.compile(r"\b(JN|JUNCTION)\b", re.IGNORECASE)


def _find_data_directory(explicit_dir: Path | None = None) -> Path | None:
    """Locate data/ directory across supported environment and project paths."""
    if explicit_dir is not None and explicit_dir.is_dir():
        return explicit_dir

    env_dir = os.getenv("STATION_DATA_DIR")
    if env_dir:
        candidate = Path(env_dir)
        if candidate.is_dir():
            return candidate

    search_candidates = [
        Path(__file__).resolve().parents[5] / "data",
        Path.cwd() / "data",
        Path.cwd().parent / "data",
    ]
    for candidate in search_candidates:
        if candidate.is_dir():
            return candidate
    return None


def load_topology_datasets(
    data_dir: Path | None = None,
) -> tuple[frozenset[str], frozenset[str], frozenset[str]]:
    """Load and merge division hubs and state capitals from JSON datasets.

    Falls back to built-in constants if JSON files are not accessible.
    """
    resolved_dir = _find_data_directory(data_dir)
    major_hubs = set(DEFAULT_MAJOR_HUBS)
    division_hqs = set(DEFAULT_DIVISION_HQS)
    state_capitals = set(DEFAULT_STATE_CAPITALS)

    if resolved_dir is None:
        return frozenset(major_hubs), frozenset(division_hqs), frozenset(state_capitals)

    # Ingest division hubs
    div_file = resolved_dir / "division_hubs.json"
    if div_file.is_file():
        try:
            div_data = json.loads(div_file.read_text(encoding="utf-8"))
            if isinstance(div_data, dict):
                for val in div_data.values():
                    if isinstance(val, dict):
                        code = str(val.get("hub_code") or "").strip().upper()
                        if code:
                            division_hqs.add(code)
        except Exception as exc:
            _LOGGER.warning("Could not load division_hubs.json: %s", exc)

    # Ingest state capitals
    cap_file = resolved_dir / "state_capitals.json"
    if cap_file.is_file():
        try:
            cap_data = json.loads(cap_file.read_text(encoding="utf-8"))
            if isinstance(cap_data, dict):
                for val in cap_data.values():
                    if isinstance(val, dict):
                        code = str(val.get("station_code") or "").strip().upper()
                        if code:
                            state_capitals.add(code)
                            major_hubs.add(code)
        except Exception as exc:
            _LOGGER.warning("Could not load state_capitals.json: %s", exc)

    return (
        frozenset(major_hubs),
        frozenset(division_hqs),
        frozenset(state_capitals),
    )


# Ingest datasets once at module load time for lock-free O(1) runtime lookups
MAJOR_HUBS, DIVISION_HQS, STATE_CAPITALS = load_topology_datasets()


def classify_station(
    station_code: str,
    station_name: str = "",
    *,
    custom_capitals: frozenset[str] | None = None,
    custom_hubs: frozenset[str] | None = None,
    custom_divs: frozenset[str] | None = None,
) -> StationRole:
    """Classify station into hierarchical role.

    Priority hierarchy:
    1. STATE_CAPITAL
    2. MAJOR_HUB
    3. DIVISION_HQ
    4. JUNCTION
    5. ADJACENT_HALT
    """
    code = station_code.strip().upper()
    name = station_name.strip()

    capitals = custom_capitals if custom_capitals is not None else STATE_CAPITALS
    hubs = custom_hubs if custom_hubs is not None else MAJOR_HUBS
    divs = custom_divs if custom_divs is not None else DIVISION_HQS

    if code in capitals:
        return StationRole.STATE_CAPITAL
    if code in hubs:
        return StationRole.MAJOR_HUB
    if code in divs:
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
        1. State Capitals and Major Hubs first (Tier 1).
        2. Divisional Headquarters next (Tier 2).
        3. Passenger Junctions third (Tier 3).
        4. Adjacent intermediate halts ONLY if fewer than 2 hubs/junctions exist.
        """
        if not intermediate_stops:
            return ()

        tier1_hubs_and_capitals: list[ScheduleStop] = []
        tier2_divs: list[ScheduleStop] = []
        tier3_jns: list[ScheduleStop] = []
        tier4_adjacent: list[ScheduleStop] = []

        for stop in intermediate_stops:
            role = classify_station(stop.station_code, stop.station_name)
            if role in {StationRole.STATE_CAPITAL, StationRole.MAJOR_HUB}:
                tier1_hubs_and_capitals.append(stop)
            elif role == StationRole.DIVISION_HQ:
                tier2_divs.append(stop)
            elif role == StationRole.JUNCTION:
                tier3_jns.append(stop)
            else:
                tier4_adjacent.append(stop)

        selected: list[ScheduleStop] = []

        for stop in tier1_hubs_and_capitals:
            if len(selected) >= max_candidates:
                break
            selected.append(stop)

        if len(selected) < max_candidates:
            for stop in tier2_divs:
                if len(selected) >= max_candidates:
                    break
                selected.append(stop)

        if len(selected) < max_candidates:
            for stop in tier3_jns:
                if len(selected) >= max_candidates:
                    break
                selected.append(stop)

        if len(selected) < 2:
            for stop in tier4_adjacent:
                if len(selected) >= max_candidates:
                    break
                selected.append(stop)

        # Re-sort selected candidates by chronological route order
        selected.sort(key=lambda s: s.stop_number)
        return tuple(selected)
