import React from 'react';
import MaximizeIcon from 'lucide-react-native/icons/maximize';
import MinimizeIcon from 'lucide-react-native/icons/minimize';
import LibraryIcon from 'lucide-react-native/icons/panel-left';
import DiscussionIcon from 'lucide-react-native/icons/panel-right';
import PreviousIcon from 'lucide-react-native/icons/chevron-left';
import CollapseIcon from 'lucide-react-native/icons/chevrons-down-up';
import ExpandIcon from 'lucide-react-native/icons/chevrons-up-down';
import SettingsIcon from 'lucide-react-native/icons/settings';
import TrashIcon from 'lucide-react-native/icons/trash';
import VideoIcon from 'lucide-react-native/icons/film';
import CommentIcon from 'lucide-react-native/icons/message-square';
import PenIcon from 'lucide-react-native/icons/pencil';
import ArrowIcon from 'lucide-react-native/icons/move-up-right';
import EllipseIcon from 'lucide-react-native/icons/ellipse';
import TargetIcon from 'lucide-react-native/icons/target';
import PointerIcon from 'lucide-react-native/icons/mouse-pointer-2';
import PlayIcon from 'lucide-react-native/icons/play';
import PauseIcon from 'lucide-react-native/icons/pause';
import ReplyIcon from 'lucide-react-native/icons/reply';
import FolderIcon from 'lucide-react-native/icons/folder';
import ChevronrightIcon from 'lucide-react-native/icons/chevron-right';
import ChevrondownIcon from 'lucide-react-native/icons/chevron-down';
import CloseIcon from 'lucide-react-native/icons/x';
import PlusIcon from 'lucide-react-native/icons/plus';
import EyeIcon from 'lucide-react-native/icons/eye';
import EyeoffIcon from 'lucide-react-native/icons/eye-off';
import ClockIcon from 'lucide-react-native/icons/clock';
import CheckIcon from 'lucide-react-native/icons/check';
import UndoIcon from 'lucide-react-native/icons/undo-2';
import RedoIcon from 'lucide-react-native/icons/redo-2';

// Per-icon imports keep the rest of Lucide out of the production bundle.
const icons = {
  maximize: MaximizeIcon,
  minimize: MinimizeIcon,
  library: LibraryIcon,
  discussion: DiscussionIcon,
  previous: PreviousIcon,
  collapse: CollapseIcon,
  expand: ExpandIcon,
  settings: SettingsIcon,
  trash: TrashIcon,
  video: VideoIcon,
  comment: CommentIcon,
  pen: PenIcon,
  arrow: ArrowIcon,
  ellipse: EllipseIcon,
  target: TargetIcon,
  pointer: PointerIcon,
  play: PlayIcon,
  pause: PauseIcon,
  reply: ReplyIcon,
  folder: FolderIcon,
  chevronRight: ChevronrightIcon,
  chevronDown: ChevrondownIcon,
  close: CloseIcon,
  plus: PlusIcon,
  eye: EyeIcon,
  eyeOff: EyeoffIcon,
  clock: ClockIcon,
  check: CheckIcon,
  undo: UndoIcon,
  redo: RedoIcon,
};
export type IconName = keyof typeof icons;
export function Icon({name, color}: {name: IconName; color: string}) {
  const Glyph = icons[name];
  return <Glyph accessible={false} size={18} color={color} strokeWidth={1.8} />;
}
