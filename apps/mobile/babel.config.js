module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // No reanimated plugin — we don't use worklets (useAnimatedStyle etc).
    // Adding it causes a crash because reanimated 4.x requires react-native-worklets
    // which is a native module not available in Expo Go's plugin system.
  };
};
