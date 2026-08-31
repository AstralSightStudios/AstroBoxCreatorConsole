import BlurEffect from "react-progressive-blur";

interface TitlebarEffectProps {
  className?: string;
}

export default function TitlebarEffect({
  className = "",
}: TitlebarEffectProps) {
  return (
    <div className={`titlebar-effect ${className}`} aria-hidden="true">
      <BlurEffect
        className="!pointer-events-none h-16 w-full"
        intensity={100}
        position="top"
      />
    </div>
  );
}
