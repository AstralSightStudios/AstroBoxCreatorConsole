import BlurEffect from "react-progressive-blur";
import { useUiScaleViewport } from "~/components/UiScaleContext";

interface TitlebarEffectProps {
  className?: string;
}

export default function TitlebarEffect({
  className = "",
}: TitlebarEffectProps) {
  const { factor, isNarrow } = useUiScaleViewport();
  const blurIntensity = isNarrow || factor !== 1 ? 180 : 100;

  return (
    <div className={`titlebar-effect ${className}`} aria-hidden="true">
      <div className="titlebar-effect-gradient" />
      <div className="titlebar-effect-blur-region">
        <BlurEffect
          className="!pointer-events-none h-full w-full"
          intensity={blurIntensity}
          position="top"
        />
      </div>
    </div>
  );
}
