import Svg, { Circle, Path, Rect } from 'react-native-svg';

// Paths copied from the approved W01 design (worker/screens/Main.dc.html and dww.css .ic).
type IconProps = { size?: number; color?: string; strokeWidth?: number };

function Icon({
  size = 22,
  color = '#000',
  strokeWidth = 2,
  children,
}: IconProps & { children: React.ReactNode }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </Svg>
  );
}

export const MailIcon = (p: IconProps) => (
  <Icon {...p}>
    <Rect x="3" y="5" width="18" height="14" rx="2" />
    <Path d="M3 7l9 6 9-6" />
  </Icon>
);

export const ArrowRightIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M5 12h14M13 6l6 6-6 6" />
  </Icon>
);

export const CashIcon = (p: IconProps) => (
  <Icon {...p}>
    <Rect x="3" y="7" width="18" height="10" rx="2" />
    <Circle cx="12" cy="12" r="2.5" />
  </Icon>
);

export const ShieldCheckIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />
    <Path d="M9 12l2 2 4-4" />
  </Icon>
);

export const PinIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M12 21s7-6 7-12a7 7 0 0 0-14 0c0 6 7 12 7 12z" />
    <Circle cx="12" cy="9" r="2.5" />
  </Icon>
);

export const ChevronLeftIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d='M15 5l-7 7 7 7' />
  </Icon>
);

export const ChevronRightIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d='M9 5l7 7-7 7' />
  </Icon>
);

export const LockIcon =(p: IconProps) => (
  <Icon {...p}>
    <Rect x='5' y='11' width='14' height='9' rx='2' />
    <Path d='M8 11V8a4 4 0 0 1 8 0v3' />
  </Icon>
);

export const PlusIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d='M12 5v14M5 12h14' />
  </Icon>
);

export const CheckIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d='M5 12l5 5 9-10' />
  </Icon>
);

export const MicIcon = (p: IconProps) => (
  <Icon {...p}>
    <Rect x="9" y="3" width="6" height="11" rx="3" />
    <Path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </Icon>
);

export const PlayIcon = ({ size = 22, color = '#000' }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M8 5v14l11-7z" fill={color} />
  </Svg>
);

export const PauseIcon = ({ size = 22, color = '#000' }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Rect x="6" y="5" width="4" height="14" rx="1" fill={color} />
    <Rect x="14" y="5" width="4" height="14" rx="1" fill={color} />
  </Svg>
);

export const StopIcon = ({ size = 22, color = '#000' }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Rect x="6" y="6" width="12" height="12" rx="2" fill={color} />
  </Svg>
);

export const ClockIcon = (p: IconProps) => (
  <Icon {...p}>
    <Circle cx="12" cy="12" r="9" />
    <Path d="M12 7v5l3 2" />
  </Icon>
);

export const PhoneIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" />
  </Icon>
);

export const HomeIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />
  </Icon>
);

export const SearchIcon = (p: IconProps) => (
  <Icon {...p}>
    <Circle cx="11" cy="11" r="7" />
    <Path d="M20 20l-4-4" />
  </Icon>
);

export const BriefcaseIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M3 8h18v12H3zM8 8V5h8v3M3 13h18" />
  </Icon>
);

export const UserIcon = (p: IconProps) => (
  <Icon {...p}>
    <Circle cx="12" cy="8" r="4" />
    <Path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
  </Icon>
);

export const BellIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4zM10 21h4" />
  </Icon>
);

export const ClockSmallIcon = (p: IconProps) => (
  <Icon {...p}>
    <Circle cx="12" cy="12" r="9" />
    <Path d="M12 7v5l3 2" />
  </Icon>
);

// Category icons for the job cards (the wrench and droplet paths are from the approved W07 design).
export const WrenchIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M14 6a4 4 0 0 0 5 5l-9 9-3-3 9-9a4 4 0 0 0-2-2zM4 4l3 3" />
  </Icon>
);

export const FlameIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M12 3s6 6 6 11a6 6 0 0 1-12 0c0-5 6-11 6-11z" />
  </Icon>
);

export const BoltIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M13 2L4 14h7l-1 8 9-12h-7z" />
  </Icon>
);

export const SnowIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9" />
  </Icon>
);

export const HammerIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M14 4l6 6-3 3-6-6zM12 9L4 17l3 3 8-8" />
  </Icon>
);

export const BrushIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M4 20c3 0 5-1 5-3a3 3 0 0 0-3-3c-2 0-2 3-2 6zM9 14L20 3l1 1L10 15" />
  </Icon>
);

export const SparkleIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" />
  </Icon>
);

export const ToolIcon = (p: IconProps) => (
  <Icon {...p}>
    <Circle cx="12" cy="12" r="3" />
    <Path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" />
  </Icon>
);

export const UsersIcon = (p: IconProps) => (
  <Icon {...p}>
    <Circle cx="9" cy="8" r="3.5" />
    <Path d="M2 20c0-3.5 3-5.5 7-5.5s7 2 7 5.5M17 5a3.5 3.5 0 0 1 0 7M19 15c2 .7 3 2.2 3 4.5" />
  </Icon>
);

export const ChevronDownIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M6 9l6 6 6-6" />
  </Icon>
);
