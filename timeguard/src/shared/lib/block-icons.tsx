"use client";

import type { LucideIcon } from "lucide-react";
import {
  Bell,
  BookOpen,
  Briefcase,
  Camera,
  Car,
  Circle,
  Code2,
  Coffee,
  Dumbbell,
  Gamepad2,
  GraduationCap,
  Heart,
  Home,
  Laptop,
  Mail,
  MapPin,
  Moon,
  Music,
  Palette,
  Pencil,
  Phone,
  Plane,
  ShoppingBag,
  Sparkles,
  Star,
  Stethoscope,
  Sun,
  Timer,
  Users,
  Utensils,
} from "lucide-react";
import {
  BLOCK_ICON_IDS,
  DEFAULT_BLOCK_ICON,
  type BlockIconId,
} from "@/shared/config/theme";

const MAP: Record<BlockIconId, LucideIcon> = {
  circle: Circle,
  briefcase: Briefcase,
  book: BookOpen,
  code: Code2,
  coffee: Coffee,
  dumbbell: Dumbbell,
  heart: Heart,
  home: Home,
  car: Car,
  utensils: Utensils,
  music: Music,
  gamepad: Gamepad2,
  phone: Phone,
  mail: Mail,
  users: Users,
  sparkles: Sparkles,
  sun: Sun,
  moon: Moon,
  plane: Plane,
  "shopping-bag": ShoppingBag,
  pencil: Pencil,
  timer: Timer,
  laptop: Laptop,
  "graduation-cap": GraduationCap,
  stethoscope: Stethoscope,
  palette: Palette,
  camera: Camera,
  "map-pin": MapPin,
  bell: Bell,
  star: Star,
};

export function resolveBlockIcon(id?: string | null): LucideIcon {
  if (id && (BLOCK_ICON_IDS as readonly string[]).includes(id)) {
    return MAP[id as BlockIconId];
  }
  return MAP[DEFAULT_BLOCK_ICON];
}

export function BlockIcon({
  id,
  className,
}: {
  id?: string | null;
  className?: string;
}) {
  const Icon = resolveBlockIcon(id);
  return <Icon className={className} />;
}
