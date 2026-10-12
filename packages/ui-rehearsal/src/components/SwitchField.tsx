// An on/off setting and its label. A switch rather than a checkbox: styles.css restyles every
// <button> but a switch, and a Radix checkbox IS a button, so its checked state never showed.

import { Switch } from "@frediverse/ui/switch";
import { type CSSProperties, type ReactNode, useId } from "react";

interface Props {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

export function SwitchField({
  checked,
  onCheckedChange,
  children,
  className,
  style,
}: Props) {
  const id = useId();
  return (
    <div className={`switch-label ${className ?? ""}`} style={style}>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
      <label htmlFor={id}>{children}</label>
    </div>
  );
}
