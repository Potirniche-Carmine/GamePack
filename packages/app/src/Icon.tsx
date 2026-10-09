import React from 'react';
import {Image} from 'react-native';
// Official Lucide assets. Regenerate with npm run icons after a library update.
const icons = {
  maximize: require('../assets/icons/maximize.png'),
  minimize: require('../assets/icons/minimize.png'),
  library: require('../assets/icons/panel-left.png'),
  discussion: require('../assets/icons/panel-right.png'),
  previous: require('../assets/icons/chevron-left.png'),
  collapse: require('../assets/icons/chevrons-down-up.png'),
  expand: require('../assets/icons/chevrons-up-down.png'),
  settings: require('../assets/icons/settings.png'),
  trash: require('../assets/icons/trash-2.png'),
  video: require('../assets/icons/film.png'),
  comment: require('../assets/icons/message-square.png'),
  pen: require('../assets/icons/pencil.png'),
  arrow: require('../assets/icons/move-up-right.png'),
  ellipse: require('../assets/icons/ellipse.png'),
  target: require('../assets/icons/target.png'),
  pointer: require('../assets/icons/mouse-pointer-2.png'),
  play: require('../assets/icons/play.png'),
  pause: require('../assets/icons/pause.png'),
  reply: require('../assets/icons/reply.png'),
  folder: require('../assets/icons/folder.png'),
  chevronRight: require('../assets/icons/chevron-right.png'),
  chevronDown: require('../assets/icons/chevron-down.png'),
  close: require('../assets/icons/x.png'),
  plus: require('../assets/icons/plus.png'),
  eye: require('../assets/icons/eye.png'),
  eyeOff: require('../assets/icons/eye-off.png'),
  clock: require('../assets/icons/clock.png'),
  check: require('../assets/icons/check.png'),
  undo: require('../assets/icons/undo-2.png'),
  redo: require('../assets/icons/redo-2.png'),
};
export type IconName = keyof typeof icons;
export function Icon({name, color}: {name: IconName; color: string}) {
  // The macOS image host retains a rendered tint when only tintColor changes.
  return <Image key={`${name}-${color}`} accessible={false} source={icons[name]} style={{width: 18, height: 18, tintColor: color}} />;
}
