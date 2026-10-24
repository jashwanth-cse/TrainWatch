import type { ConfigContext, ExpoConfig } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => {
  const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  return {
    ...config,
    name: config.name ?? 'TrainWatch',
    slug: config.slug ?? 'trainwatch',
    plugins: [
      ...(config.plugins ?? []),
      ...(iosClientId
        ? [[
            '@react-native-google-signin/google-signin',
            { iosUrlScheme: iosClientId.split('.').reverse().join('.') },
          ] as [string, { iosUrlScheme: string }]]
        : []),
    ],
  };
};
