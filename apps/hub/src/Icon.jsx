// tools.json names icons by their Lucide name ("calendar-days"). Only the icons
// listed here are bundled; an unknown name falls back to a link icon. Adding a
// tool with a new icon = add it to this map.
import {
  ArrowRight, Bell, Building, Calculator, Camera, CalendarDays, CalendarX, ChartLine, ChevronDown, ChevronLeft,
  ChevronRight, ClipboardList, ClipboardPaste, Merge, Plus, Split, ThumbsUp, Trash2, ExternalLink, FileCheck, FileText, FolderKanban, GraduationCap, Headset, Inbox, Laptop,
  Link, Lock, LogOut, Mail, MapPin, MessageCircle, MessageSquare, SendHorizontal, Share2, Smile, Package, Pencil, Phone, RefreshCw, Search, Settings, Stethoscope, User, UserPlus, Users,
  Wrench,
} from 'lucide-react'

const ICONS = {
  'arrow-right': ArrowRight,
  'bell': Bell,
  'camera': Camera,
  'clipboard-paste': ClipboardPaste,
  'merge': Merge,
  'plus': Plus,
  'split': Split,
  'thumbs-up': ThumbsUp,
  'trash': Trash2,
  'lock': Lock,
  'pencil': Pencil,
  'user': User,
  'user-plus': UserPlus,
  'building': Building,
  'calendar-x': CalendarX,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  'laptop': Laptop,
  'map-pin': MapPin,
  'inbox': Inbox,
  'calculator': Calculator,
  'calendar-days': CalendarDays,
  'chart-line': ChartLine,
  'chevron-down': ChevronDown,
  'clipboard-list': ClipboardList,
  'external-link': ExternalLink,
  'file-check': FileCheck,
  'file-text': FileText,
  'graduation-cap': GraduationCap,
  'headset': Headset,
  'link': Link,
  'log-out': LogOut,
  'mail': Mail,
  'message-circle': MessageCircle,
  'message-square': MessageSquare,
  'send': SendHorizontal,
  'share': Share2,
  'smile': Smile,
  'package': Package,
  'phone': Phone,
  'refresh-cw': RefreshCw,
  'search': Search,
  'settings': Settings,
  'stethoscope': Stethoscope,
  'users': Users,
  'wrench': Wrench,
  'folder-kanban': FolderKanban,
}

export default function Icon({ name, size = 20, ...rest }) {
  const Component = ICONS[name] || Link
  return <Component size={size} strokeWidth={size > 32 ? 1.5 : 2} aria-hidden="true" {...rest} />
}
