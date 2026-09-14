import { User } from "@icon-park/react";
import { iconParkOutline } from "@/lib/iconPark";
import { cn } from "@/lib/utils";

export function isAvatarUrl(value: string) {
  const v = value.trim();
  return /^(https?:\/\/|\/|data:)/i.test(v);
}

type Props = {
  value: string;
  iconSize?: number;
  className?: string;
};

/** 关于页头像：图片 URL 或 IconPark 占位，不用 emoji */
export function AboutAvatar({ value, iconSize = 36, className }: Props) {
  const trimmed = value.trim();
  if (isAvatarUrl(trimmed)) {
    return <img src={trimmed} alt="" className={cn("size-full object-cover", className)} />;
  }
  return (
    <User
      {...iconParkOutline}
      size={iconSize}
      className={cn("block shrink-0", className)}
      aria-hidden
    />
  );
}
