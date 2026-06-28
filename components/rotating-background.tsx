import { PropsWithChildren, useEffect, useState } from 'react';
import { ImageBackground, ImageSourcePropType, StyleProp, ViewStyle } from 'react-native';

const BACKGROUND_IMAGES: ImageSourcePropType[] = [
  require('../images/Cervantes.jpg'),
  require('../images/Quijote3.jpg'),
  require('../images/Quijote4.jpg'),
];

const BACKGROUND_ROTATION_MS = 5 * 60 * 1000;

type RotatingBackgroundProps = PropsWithChildren<{
  style?: StyleProp<ViewStyle>;
}>;

export function RotatingBackground({ children, style }: RotatingBackgroundProps) {
  const [backgroundIndex, setBackgroundIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setBackgroundIndex((currentIndex) => (currentIndex + 1) % BACKGROUND_IMAGES.length);
    }, BACKGROUND_ROTATION_MS);

    return () => clearInterval(interval);
  }, []);

  return (
    <ImageBackground
      resizeMode="cover"
      source={BACKGROUND_IMAGES[backgroundIndex]}
      style={style}>
      {children}
    </ImageBackground>
  );
}
