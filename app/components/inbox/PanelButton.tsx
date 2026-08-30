import type { ReactNode } from "react";
import { Spinner } from "@radix-ui/themes";
import { motion } from "framer-motion";
import {
  panelButtonActiveClass,
  panelButtonDangerClass,
  panelButtonQuietClass,
} from "./styles";

export default function PanelButton({
  children,
  active,
  danger,
  fullWidth,
  disabled,
  loading,
  onClick,
}: {
  children: ReactNode;
  active?: boolean;
  danger?: boolean;
  fullWidth?: boolean;
  disabled?: boolean;
  loading?: boolean;
  onClick: () => void;
}) {
  const buttonClassName = danger
    ? panelButtonDangerClass
    : active
      ? panelButtonActiveClass
      : panelButtonQuietClass;
  const isDisabled = disabled || loading;

  return (
    <motion.button
      whileTap={isDisabled ? undefined : { scale: 0.96 }}
      type="button"
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={`${buttonClassName} ${fullWidth ? "w-full" : ""}`}
      onClick={onClick}
    >
      {loading ? <Spinner size="1" /> : children}
    </motion.button>
  );
}
