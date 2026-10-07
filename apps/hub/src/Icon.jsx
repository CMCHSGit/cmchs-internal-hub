// tools.json names icons by their Lucide name ("calendar-days"). Only the icons
// listed here are bundled; an unknown name falls back to a link icon. Adding a
// tool with a new icon = add it to this map.
import {
  Calculator, CalendarDays, ChartLine, ChevronDown, ClipboardList, ExternalLink, FileCheck,
  FileText, GraduationCap, Headset, Link, LogOut, Mail, MessageSquare, Package, Phone,
  RefreshCw, Search, Stethoscope, Users, Wrench,
} from 'lucide-react'

const ICONS = {
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
  'message-square': MessageSquare,
  'package': Package,
  'phone': Phone,
  'refresh-cw': RefreshCw,
  'search': Search,
  'stethoscope': Stethoscope,
  'users': Users,
  'wrench': Wrench,
}

export default function Icon({ name, size = 20, ...rest }) {
  const Component = ICONS[name] || Link
  return <Component size={size} strokeWidth={size > 32 ? 1.5 : 2} aria-hidden="true" {...rest} />
}
