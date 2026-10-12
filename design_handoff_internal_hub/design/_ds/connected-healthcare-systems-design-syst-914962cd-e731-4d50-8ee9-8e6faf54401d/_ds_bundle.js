/* @ds-bundle: {"format":4,"namespace":"ConnectedHealthcareSystemsDesignSystem_914962","components":[{"name":"Badge","sourcePath":"components/core/Badge.jsx"},{"name":"Button","sourcePath":"components/core/Button.jsx"},{"name":"Card","sourcePath":"components/core/Card.jsx"},{"name":"Icon","sourcePath":"components/core/Icon.jsx"},{"name":"IconButton","sourcePath":"components/core/IconButton.jsx"},{"name":"Logo","sourcePath":"components/core/Logo.jsx"},{"name":"StripeRule","sourcePath":"components/core/StripeRule.jsx"},{"name":"Tag","sourcePath":"components/core/Tag.jsx"},{"name":"Alert","sourcePath":"components/feedback/Alert.jsx"},{"name":"Dialog","sourcePath":"components/feedback/Dialog.jsx"},{"name":"Toast","sourcePath":"components/feedback/Toast.jsx"},{"name":"Tooltip","sourcePath":"components/feedback/Tooltip.jsx"},{"name":"Checkbox","sourcePath":"components/forms/Checkbox.jsx"},{"name":"Field","sourcePath":"components/forms/Field.jsx"},{"name":"Input","sourcePath":"components/forms/Input.jsx"},{"name":"RadioGroup","sourcePath":"components/forms/RadioGroup.jsx"},{"name":"Select","sourcePath":"components/forms/Select.jsx"},{"name":"Switch","sourcePath":"components/forms/Switch.jsx"},{"name":"Textarea","sourcePath":"components/forms/Textarea.jsx"},{"name":"Breadcrumbs","sourcePath":"components/navigation/Breadcrumbs.jsx"},{"name":"Pagination","sourcePath":"components/navigation/Pagination.jsx"},{"name":"Tabs","sourcePath":"components/navigation/Tabs.jsx"}],"sourceHashes":{"components/core/Badge.jsx":"3aca9c2989fc","components/core/Button.jsx":"ddab5e527c03","components/core/Card.jsx":"e14588e87fb1","components/core/Icon.jsx":"a72a85c41afb","components/core/IconButton.jsx":"32957320c660","components/core/Logo.jsx":"90b9371d8c18","components/core/StripeRule.jsx":"a650cdf0dffd","components/core/Tag.jsx":"34dd5eb06444","components/feedback/Alert.jsx":"63193e9f7764","components/feedback/Dialog.jsx":"02e3e81dfbec","components/feedback/Toast.jsx":"fc8e48038bd9","components/feedback/Tooltip.jsx":"dccb062b2cc4","components/forms/Checkbox.jsx":"d02ffe03b86d","components/forms/Field.jsx":"9f9570087320","components/forms/Input.jsx":"12613d58bea0","components/forms/RadioGroup.jsx":"df32dfdebaec","components/forms/Select.jsx":"0a6245427bd8","components/forms/Switch.jsx":"ffce03b7f4bc","components/forms/Textarea.jsx":"8464dccc79a7","components/navigation/Breadcrumbs.jsx":"b00e129f7c62","components/navigation/Pagination.jsx":"200fe4470432","components/navigation/Tabs.jsx":"ee9a88efb9f4","ui_kits/stationery/Stationery.jsx":"6964f9eaa8b5","ui_kits/website/WebChrome.jsx":"e080559a9336","ui_kits/website/WebHome.jsx":"6040fabb062d","ui_kits/website/WebPages.jsx":"f75aecc45415"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.ConnectedHealthcareSystemsDesignSystem_914962 = window.ConnectedHealthcareSystemsDesignSystem_914962 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/core/Badge.jsx
try { (() => {
const TONES = {
  purple: ['var(--chs-purple)', 'var(--chs-purple-20)'],
  green: ['#5b8801', 'var(--chs-green-20)'],
  orange: ['#a85800', 'var(--chs-orange-20)'],
  neutral: ['var(--text-body)', 'var(--chs-black-10)'],
  critical: ['var(--status-critical)', 'var(--status-critical-tint)']
};
function Badge({
  children,
  tone = 'purple',
  variant = 'soft',
  dot = false,
  style
}) {
  const [fg, bg] = TONES[tone] || TONES.purple;
  const skin = variant === 'solid' ? {
    background: tone === 'neutral' ? 'var(--chs-black-80)' : fg,
    color: 'var(--text-inverse)',
    border: '1px solid transparent'
  } : variant === 'outline' ? {
    background: 'transparent',
    color: fg,
    border: '1px solid ' + fg
  } : {
    background: bg,
    color: fg,
    border: '1px solid transparent'
  };
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      padding: '3px 10px',
      borderRadius: 'var(--radius-pill)',
      font: 'var(--type-overline)',
      letterSpacing: '.06em',
      textTransform: 'uppercase',
      whiteSpace: 'nowrap',
      ...skin,
      ...style
    }
  }, dot && /*#__PURE__*/React.createElement("span", {
    style: {
      width: 6,
      height: 6,
      borderRadius: 'var(--radius-circle)',
      background: 'currentColor'
    }
  }), children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Badge.jsx", error: String((e && e.message) || e) }); }

// components/core/Button.jsx
try { (() => {
const SIZES = {
  sm: {
    padding: '6px 14px',
    font: 'var(--type-body-sm)',
    minHeight: 32
  },
  md: {
    padding: '10px 20px',
    font: 'var(--type-body-strong)',
    minHeight: 42
  },
  lg: {
    padding: '14px 28px',
    font: 'var(--weight-semibold) var(--size-body-lg)/1.2 var(--font-body)',
    minHeight: 52
  }
};
const TONES = {
  purple: {
    base: 'var(--chs-purple)',
    hover: '#48397f',
    press: '#3b2f6b',
    tint: 'var(--chs-purple-20)'
  },
  green: {
    base: 'var(--chs-green)',
    hover: '#6ca301',
    press: '#5b8801',
    tint: 'var(--chs-green-20)'
  },
  orange: {
    base: 'var(--chs-orange)',
    hover: '#d06d00',
    press: '#b45e00',
    tint: 'var(--chs-orange-20)'
  }
};
function Button({
  children,
  variant = 'primary',
  tone = 'purple',
  size = 'md',
  block = false,
  disabled = false,
  iconLeft,
  iconRight,
  type = 'button',
  onClick,
  style
}) {
  const [hover, setHover] = React.useState(false);
  const [press, setPress] = React.useState(false);
  const s = SIZES[size] || SIZES.md;
  const t = TONES[tone] || TONES.purple;
  const state = disabled ? 'base' : press ? 'press' : hover ? 'hover' : 'base';
  const skins = {
    primary: {
      background: t[state],
      color: 'var(--text-inverse)',
      border: '1px solid transparent',
      boxShadow: press && !disabled ? 'var(--shadow-inset-press)' : 'none'
    },
    secondary: {
      background: state === 'base' ? 'transparent' : t.tint,
      color: t.base,
      border: '1px solid ' + t.base
    },
    ghost: {
      background: state === 'base' ? 'transparent' : 'var(--surface-subtle)',
      color: 'var(--text-strong)',
      border: '1px solid transparent'
    },
    inverse: {
      background: state === 'base' ? 'var(--chs-white)' : 'rgba(255,255,255,.86)',
      color: t.base,
      border: '1px solid transparent'
    }
  };
  return /*#__PURE__*/React.createElement("button", {
    type: type,
    disabled: disabled,
    onClick: disabled ? undefined : onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => {
      setHover(false);
      setPress(false);
    },
    onMouseDown: () => setPress(true),
    onMouseUp: () => setPress(false),
    style: {
      display: block ? 'flex' : 'inline-flex',
      width: block ? '100%' : 'auto',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 'var(--space-2)',
      padding: s.padding,
      minHeight: s.minHeight,
      font: s.font,
      borderRadius: 'var(--radius-md)',
      cursor: disabled ? 'not-allowed' : 'pointer',
      transition: 'var(--transition-control)',
      opacity: disabled ? 0.45 : 1,
      textAlign: 'center',
      ...skins[variant],
      ...style
    }
  }, iconLeft, children, iconRight);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Button.jsx", error: String((e && e.message) || e) }); }

// components/core/Icon.jsx
try { (() => {
/* Lucide is loaded from CDN (see readme ICONOGRAPHY) — the brand ships no icon set of its own.
   This wrapper keeps stroke weight and sizing consistent across the system. */
function Icon({
  name,
  size = 20,
  color = 'currentColor',
  strokeWidth = 2,
  style
}) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    const draw = () => {
      const lucide = typeof window !== 'undefined' && window.lucide;
      if (!lucide || !ref.current) return false;
      const icons = lucide.icons || {};
      const key = name.replace(/(^|-)([a-z])/g, (_, a, b) => b.toUpperCase());
      const node = icons[key] || icons[name];
      if (!node) return false;
      const svg = lucide.createElement(node);
      svg.setAttribute('width', size);
      svg.setAttribute('height', size);
      svg.setAttribute('stroke-width', strokeWidth);
      svg.setAttribute('stroke', 'currentColor');
      ref.current.innerHTML = '';
      ref.current.appendChild(svg);
      return true;
    };
    if (!draw()) {
      const t = setInterval(() => {
        if (draw()) clearInterval(t);
      }, 120);
      return () => clearInterval(t);
    }
  }, [name, size, strokeWidth]);
  return /*#__PURE__*/React.createElement("span", {
    ref: ref,
    "aria-hidden": "true",
    style: {
      display: 'inline-flex',
      width: size,
      height: size,
      color,
      flex: '0 0 auto',
      ...style
    }
  });
}
Object.assign(__ds_scope, { Icon });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Icon.jsx", error: String((e && e.message) || e) }); }

// components/core/IconButton.jsx
try { (() => {
const SZ = {
  sm: 30,
  md: 38,
  lg: 46
};
function IconButton({
  children,
  label,
  variant = 'ghost',
  tone = 'purple',
  size = 'md',
  disabled = false,
  onClick,
  style
}) {
  const [hover, setHover] = React.useState(false);
  const d = SZ[size] || SZ.md;
  const accent = tone === 'green' ? 'var(--chs-green)' : tone === 'orange' ? 'var(--chs-orange)' : 'var(--chs-purple)';
  const skins = {
    ghost: {
      background: hover && !disabled ? 'var(--surface-subtle)' : 'transparent',
      color: 'var(--text-body)',
      border: '1px solid transparent'
    },
    outline: {
      background: hover && !disabled ? 'var(--surface-subtle)' : 'var(--surface-card)',
      color: accent,
      border: '1px solid var(--border-hairline)'
    },
    solid: {
      background: accent,
      color: 'var(--text-inverse)',
      border: '1px solid transparent',
      filter: hover && !disabled ? 'brightness(.9)' : 'none'
    }
  };
  return /*#__PURE__*/React.createElement("button", {
    type: "button",
    "aria-label": label,
    title: label,
    disabled: disabled,
    onClick: disabled ? undefined : onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      width: d,
      height: d,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 'var(--radius-md)',
      cursor: disabled ? 'not-allowed' : 'pointer',
      padding: 0,
      transition: 'var(--transition-control)',
      opacity: disabled ? 0.45 : 1,
      ...skins[variant],
      ...style
    }
  }, children);
}
Object.assign(__ds_scope, { IconButton });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/IconButton.jsx", error: String((e && e.message) || e) }); }

// components/core/Logo.jsx
try { (() => {
/* Uses the supplied artwork only — never re-typeset or recolour the logo.
   assetBase must point at the design system's /assets directory. */
function Logo({
  variant = 'full-colour',
  width = 200,
  assetBase = 'assets',
  clearSpace = true,
  style
}) {
  const src = {
    'full-colour': assetBase + '/logo-full-colour.png',
    'reversed': assetBase + '/logo-full-reversed.png',
    'mark': assetBase + '/logo-mark.png',
    'mark-white': assetBase + '/logo-mark-white.png'
  }[variant];
  const isMark = variant.indexOf('mark') === 0;
  return /*#__PURE__*/React.createElement("img", {
    src: src,
    alt: "Connected Healthcare Systems",
    style: {
      width,
      height: 'auto',
      padding: clearSpace ? isMark ? width * 0.14 : width * 0.09 : 0,
      display: 'block',
      ...style
    }
  });
}
Object.assign(__ds_scope, { Logo });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Logo.jsx", error: String((e && e.message) || e) }); }

// components/core/StripeRule.jsx
try { (() => {
/* The three-stripe device: connect patients, lives and health. */
function StripeRule({
  thickness = 6,
  orientation = 'horizontal',
  order = ['purple', 'green', 'orange'],
  style
}) {
  const map = {
    purple: 'var(--chs-purple)',
    green: 'var(--chs-green)',
    orange: 'var(--chs-orange)'
  };
  const horiz = orientation === 'horizontal';
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: horiz ? 'row' : 'column',
      width: horiz ? '100%' : thickness,
      height: horiz ? thickness : '100%',
      ...style
    }
  }, order.map(c => /*#__PURE__*/React.createElement("span", {
    key: c,
    style: {
      flex: 1,
      background: map[c] || c
    }
  })));
}
Object.assign(__ds_scope, { StripeRule });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/StripeRule.jsx", error: String((e && e.message) || e) }); }

// components/core/Card.jsx
try { (() => {
function Card({
  children,
  variant = 'elevated',
  accent,
  interactive = false,
  padding = 'var(--space-6)',
  ghost = false,
  assetBase = 'assets',
  style,
  onClick
}) {
  const [hover, setHover] = React.useState(false);
  const skins = {
    elevated: {
      background: 'var(--surface-card)',
      border: '1px solid transparent',
      boxShadow: hover && interactive ? 'var(--shadow-card-hover)' : 'var(--shadow-card)'
    },
    outlined: {
      background: 'var(--surface-card)',
      border: '1px solid var(--border-hairline)',
      boxShadow: hover && interactive ? 'var(--shadow-card)' : 'none'
    },
    tinted: {
      background: 'var(--surface-subtle)',
      border: '1px solid transparent',
      boxShadow: 'none'
    },
    inverse: {
      background: 'var(--surface-inverse)',
      border: '1px solid transparent',
      boxShadow: 'none',
      color: 'var(--text-inverse)'
    }
  };
  return /*#__PURE__*/React.createElement("div", {
    onClick: onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      position: 'relative',
      overflow: 'hidden',
      borderRadius: 'var(--radius-card)',
      transition: 'box-shadow var(--duration-base) var(--ease-standard),transform var(--duration-base) var(--ease-standard)',
      transform: interactive && hover ? 'translateY(-2px)' : 'none',
      cursor: interactive ? 'pointer' : 'default',
      ...skins[variant],
      ...style
    }
  }, accent === 'stripes' && /*#__PURE__*/React.createElement(__ds_scope.StripeRule, {
    thickness: 5
  }), accent && accent !== 'stripes' && /*#__PURE__*/React.createElement("div", {
    style: {
      height: 5,
      background: 'var(--chs-' + accent + ')'
    }
  }), ghost && /*#__PURE__*/React.createElement("img", {
    src: assetBase + '/logo-mark.png',
    alt: "",
    style: {
      position: 'absolute',
      right: '-8%',
      bottom: '-14%',
      width: '46%',
      opacity: 'var(--ghost-opacity-card)',
      pointerEvents: 'none'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      padding,
      position: 'relative'
    }
  }, children));
}
Object.assign(__ds_scope, { Card });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Card.jsx", error: String((e && e.message) || e) }); }

// components/core/Tag.jsx
try { (() => {
function Tag({
  children,
  selected = false,
  removable = false,
  onRemove,
  onClick,
  style
}) {
  const [hover, setHover] = React.useState(false);
  return /*#__PURE__*/React.createElement("span", {
    onClick: onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      padding: '5px 12px',
      borderRadius: 'var(--radius-pill)',
      font: 'var(--type-body-sm)',
      background: selected ? 'var(--chs-purple)' : hover ? 'var(--surface-subtle)' : 'var(--surface-card)',
      color: selected ? 'var(--text-inverse)' : 'var(--text-body)',
      border: '1px solid ' + (selected ? 'var(--chs-purple)' : 'var(--border-hairline)'),
      cursor: onClick ? 'pointer' : 'default',
      transition: 'var(--transition-control)',
      ...style
    }
  }, children, removable && /*#__PURE__*/React.createElement("span", {
    role: "button",
    "aria-label": "Remove",
    onClick: e => {
      e.stopPropagation();
      onRemove && onRemove(e);
    },
    style: {
      cursor: 'pointer',
      opacity: .6,
      fontSize: 14,
      lineHeight: 1
    }
  }, "\xD7"));
}
Object.assign(__ds_scope, { Tag });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Tag.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Alert.jsx
try { (() => {
const TONES = {
  info: ['var(--chs-purple)', 'var(--surface-brand-tint)'],
  success: ['#5b8801', 'var(--chs-green-20)'],
  warning: ['#a85800', 'var(--chs-orange-20)'],
  critical: ['var(--status-critical)', 'var(--status-critical-tint)']
};
function Alert({
  tone = 'info',
  title,
  children,
  icon,
  style
}) {
  const [fg, bg] = TONES[tone] || TONES.info;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 'var(--space-3)',
      background: bg,
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4) var(--space-5)',
      ...style
    }
  }, icon && /*#__PURE__*/React.createElement("span", {
    style: {
      color: fg,
      display: 'flex',
      flex: '0 0 auto',
      marginTop: 2
    }
  }, icon), /*#__PURE__*/React.createElement("div", null, title && /*#__PURE__*/React.createElement("div", {
    style: {
      font: 'var(--type-body-strong)',
      color: fg
    }
  }, title), children && /*#__PURE__*/React.createElement("div", {
    style: {
      font: 'var(--type-body-sm)',
      color: 'var(--text-body)'
    }
  }, children)));
}
Object.assign(__ds_scope, { Alert });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Alert.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Dialog.jsx
try { (() => {
function Dialog({
  open = false,
  title,
  description,
  children,
  footer,
  width = 520,
  onClose,
  style
}) {
  if (!open) return null;
  return /*#__PURE__*/React.createElement("div", {
    role: "presentation",
    onClick: onClose,
    style: {
      position: 'fixed',
      inset: 0,
      background: 'rgba(29,29,29,.5)',
      backdropFilter: 'blur(2px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 'var(--space-6)',
      zIndex: 60
    }
  }, /*#__PURE__*/React.createElement("div", {
    role: "dialog",
    "aria-modal": "true",
    onClick: e => e.stopPropagation(),
    style: {
      background: 'var(--surface-card)',
      borderRadius: 'var(--radius-card)',
      boxShadow: 'var(--shadow-overlay)',
      width,
      maxWidth: '100%',
      overflow: 'hidden',
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      height: 5
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      background: 'var(--stripe-1)'
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      background: 'var(--stripe-2)'
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      background: 'var(--stripe-3)'
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 'var(--space-6)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-start',
      gap: 'var(--space-4)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, title && /*#__PURE__*/React.createElement("h3", {
    style: {
      font: 'var(--type-h3)',
      color: 'var(--text-strong)',
      margin: 0
    }
  }, title), description && /*#__PURE__*/React.createElement("p", {
    style: {
      font: 'var(--type-body)',
      color: 'var(--text-body)',
      margin: 'var(--space-2) 0 0'
    }
  }, description)), onClose && /*#__PURE__*/React.createElement("button", {
    onClick: onClose,
    "aria-label": "Close",
    style: {
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      font: 'var(--type-h3)',
      color: 'var(--text-muted)',
      lineHeight: 1
    }
  }, "\xD7")), children && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 'var(--space-5)'
    }
  }, children), footer && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 'var(--space-6)',
      display: 'flex',
      justifyContent: 'flex-end',
      gap: 'var(--space-3)'
    }
  }, footer))));
}
Object.assign(__ds_scope, { Dialog });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Dialog.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Toast.jsx
try { (() => {
const TONES = {
  success: ['var(--chs-green)', 'var(--chs-green-20)'],
  info: ['var(--chs-purple)', 'var(--chs-purple-20)'],
  warning: ['var(--chs-orange)', 'var(--chs-orange-20)'],
  critical: ['var(--status-critical)', 'var(--status-critical-tint)']
};
function Toast({
  tone = 'info',
  title,
  message,
  icon,
  onDismiss,
  style
}) {
  const [fg, bg] = TONES[tone] || TONES.info;
  return /*#__PURE__*/React.createElement("div", {
    role: "status",
    style: {
      display: 'flex',
      gap: 'var(--space-3)',
      alignItems: 'flex-start',
      minWidth: 300,
      maxWidth: 440,
      background: 'var(--surface-card)',
      borderRadius: 'var(--radius-md)',
      boxShadow: 'var(--shadow-overlay)',
      borderLeft: 'none',
      overflow: 'hidden',
      padding: 'var(--space-4)',
      position: 'relative',
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      left: 0,
      top: 0,
      bottom: 0,
      width: 4,
      background: fg
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      width: 26,
      height: 26,
      borderRadius: 'var(--radius-circle)',
      background: bg,
      color: fg,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flex: '0 0 auto',
      marginLeft: 'var(--space-1)'
    }
  }, icon || '•'), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, title && /*#__PURE__*/React.createElement("div", {
    style: {
      font: 'var(--type-body-strong)',
      color: 'var(--text-strong)'
    }
  }, title), message && /*#__PURE__*/React.createElement("div", {
    style: {
      font: 'var(--type-body-sm)',
      color: 'var(--text-body)'
    }
  }, message)), onDismiss && /*#__PURE__*/React.createElement("button", {
    onClick: onDismiss,
    "aria-label": "Dismiss",
    style: {
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      color: 'var(--text-muted)',
      fontSize: 16,
      lineHeight: 1
    }
  }, "\xD7"));
}
Object.assign(__ds_scope, { Toast });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Toast.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Tooltip.jsx
try { (() => {
function Tooltip({
  label,
  placement = 'top',
  children,
  style
}) {
  const [open, setOpen] = React.useState(false);
  const pos = {
    top: {
      bottom: '100%',
      left: '50%',
      transform: 'translate(-50%,-8px)'
    },
    bottom: {
      top: '100%',
      left: '50%',
      transform: 'translate(-50%,8px)'
    },
    left: {
      right: '100%',
      top: '50%',
      transform: 'translate(-8px,-50%)'
    },
    right: {
      left: '100%',
      top: '50%',
      transform: 'translate(8px,-50%)'
    }
  }[placement];
  return /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'relative',
      display: 'inline-flex',
      ...style
    },
    onMouseEnter: () => setOpen(true),
    onMouseLeave: () => setOpen(false),
    onFocus: () => setOpen(true),
    onBlur: () => setOpen(false)
  }, children, /*#__PURE__*/React.createElement("span", {
    role: "tooltip",
    style: {
      position: 'absolute',
      ...pos,
      background: 'var(--surface-inverse)',
      color: 'var(--text-inverse)',
      font: 'var(--type-caption)',
      padding: '5px 9px',
      borderRadius: 'var(--radius-sm)',
      whiteSpace: 'nowrap',
      opacity: open ? 1 : 0,
      pointerEvents: 'none',
      zIndex: 40,
      transition: 'opacity var(--duration-fast) var(--ease-standard)'
    }
  }, label));
}
Object.assign(__ds_scope, { Tooltip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Tooltip.jsx", error: String((e && e.message) || e) }); }

// components/forms/Checkbox.jsx
try { (() => {
function Checkbox({
  checked,
  defaultChecked,
  label,
  hint,
  disabled = false,
  onChange,
  id,
  style
}) {
  const isControlled = checked !== undefined;
  const [inner, setInner] = React.useState(!!defaultChecked);
  const on = isControlled ? checked : inner;
  const toggle = () => {
    if (disabled) return;
    if (!isControlled) setInner(!on);
    onChange && onChange(!on);
  };
  return /*#__PURE__*/React.createElement("label", {
    htmlFor: id,
    onClick: toggle,
    style: {
      display: 'flex',
      gap: 'var(--space-3)',
      alignItems: 'flex-start',
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? .5 : 1,
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 18,
      height: 18,
      flex: '0 0 auto',
      marginTop: 2,
      borderRadius: 'var(--radius-sm)',
      background: on ? 'var(--chs-purple)' : 'var(--surface-card)',
      border: '1px solid ' + (on ? 'var(--chs-purple)' : 'var(--border-strong)'),
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      transition: 'var(--transition-control)',
      color: 'var(--text-inverse)',
      fontSize: 12,
      lineHeight: 1
    }
  }, on ? '✓' : ''), /*#__PURE__*/React.createElement("span", null, label && /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--type-body)',
      color: 'var(--text-strong)',
      display: 'block'
    }
  }, label), hint && /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--type-caption)',
      color: 'var(--text-muted)'
    }
  }, hint)));
}
Object.assign(__ds_scope, { Checkbox });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Checkbox.jsx", error: String((e && e.message) || e) }); }

// components/forms/Field.jsx
try { (() => {
function Field({
  label,
  hint,
  error,
  required = false,
  htmlFor,
  children,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-2)',
      ...style
    }
  }, label && /*#__PURE__*/React.createElement("label", {
    htmlFor: htmlFor,
    style: {
      font: 'var(--type-body-strong)',
      fontSize: 'var(--size-body-sm)',
      color: 'var(--text-strong)'
    }
  }, label, required && /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--chs-orange)'
    }
  }, " *")), children, (error || hint) && /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--type-caption)',
      color: error ? 'var(--status-critical)' : 'var(--text-muted)'
    }
  }, error || hint));
}
Object.assign(__ds_scope, { Field });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Field.jsx", error: String((e && e.message) || e) }); }

// components/forms/Input.jsx
try { (() => {
function Input({
  value,
  defaultValue,
  placeholder,
  type = 'text',
  disabled = false,
  invalid = false,
  iconLeft,
  size = 'md',
  onChange,
  id,
  style
}) {
  const [focus, setFocus] = React.useState(false);
  const pad = size === 'sm' ? '7px 10px' : size === 'lg' ? '14px 16px' : '10px 12px';
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-2)',
      background: disabled ? 'var(--surface-subtle)' : 'var(--surface-card)',
      border: '1px solid ' + (invalid ? 'var(--status-critical)' : focus ? 'var(--border-focus)' : 'var(--border-hairline)'),
      borderRadius: 'var(--radius-md)',
      boxShadow: focus ? 'var(--focus-ring)' : 'none',
      transition: 'var(--transition-control)',
      padding: pad,
      ...style
    }
  }, iconLeft && /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-muted)',
      display: 'flex'
    }
  }, iconLeft), /*#__PURE__*/React.createElement("input", {
    id: id,
    type: type,
    value: value,
    defaultValue: defaultValue,
    placeholder: placeholder,
    disabled: disabled,
    onChange: onChange,
    onFocus: () => setFocus(true),
    onBlur: () => setFocus(false),
    style: {
      font: 'var(--type-body)',
      color: 'var(--text-strong)',
      border: 'none',
      outline: 'none',
      background: 'transparent',
      width: '100%',
      minWidth: 0
    }
  }));
}
Object.assign(__ds_scope, { Input });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Input.jsx", error: String((e && e.message) || e) }); }

// components/forms/RadioGroup.jsx
try { (() => {
function RadioGroup({
  name,
  value,
  options = [],
  onChange,
  direction = 'column',
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    role: "radiogroup",
    style: {
      display: 'flex',
      flexDirection: direction,
      gap: direction === 'row' ? 'var(--space-6)' : 'var(--space-3)',
      ...style
    }
  }, options.map(o => {
    const opt = typeof o === 'string' ? {
      value: o,
      label: o
    } : o;
    const on = value === opt.value;
    return /*#__PURE__*/React.createElement("label", {
      key: opt.value,
      onClick: () => onChange && onChange(opt.value),
      style: {
        display: 'flex',
        gap: 'var(--space-3)',
        alignItems: 'center',
        cursor: 'pointer'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        width: 18,
        height: 18,
        borderRadius: 'var(--radius-circle)',
        flex: '0 0 auto',
        border: '1px solid ' + (on ? 'var(--chs-purple)' : 'var(--border-strong)'),
        background: 'var(--surface-card)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'var(--transition-control)'
      }
    }, on && /*#__PURE__*/React.createElement("span", {
      style: {
        width: 9,
        height: 9,
        borderRadius: 'var(--radius-circle)',
        background: 'var(--chs-purple)'
      }
    })), /*#__PURE__*/React.createElement("span", {
      style: {
        font: 'var(--type-body)',
        color: 'var(--text-strong)'
      }
    }, opt.label));
  }));
}
Object.assign(__ds_scope, { RadioGroup });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/RadioGroup.jsx", error: String((e && e.message) || e) }); }

// components/forms/Select.jsx
try { (() => {
function Select({
  value,
  defaultValue,
  options = [],
  placeholder,
  disabled = false,
  invalid = false,
  onChange,
  id,
  style
}) {
  const [focus, setFocus] = React.useState(false);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      ...style
    }
  }, /*#__PURE__*/React.createElement("select", {
    id: id,
    value: value,
    defaultValue: defaultValue,
    disabled: disabled,
    onChange: onChange,
    onFocus: () => setFocus(true),
    onBlur: () => setFocus(false),
    style: {
      appearance: 'none',
      width: '100%',
      font: 'var(--type-body)',
      color: 'var(--text-strong)',
      padding: '10px 36px 10px 12px',
      background: disabled ? 'var(--surface-subtle)' : 'var(--surface-card)',
      border: '1px solid ' + (invalid ? 'var(--status-critical)' : focus ? 'var(--border-focus)' : 'var(--border-hairline)'),
      borderRadius: 'var(--radius-md)',
      boxShadow: focus ? 'var(--focus-ring)' : 'none',
      outline: 'none',
      transition: 'var(--transition-control)',
      cursor: disabled ? 'not-allowed' : 'pointer'
    }
  }, placeholder && /*#__PURE__*/React.createElement("option", {
    value: ""
  }, placeholder), options.map(o => {
    const opt = typeof o === 'string' ? {
      value: o,
      label: o
    } : o;
    return /*#__PURE__*/React.createElement("option", {
      key: opt.value,
      value: opt.value
    }, opt.label);
  })), /*#__PURE__*/React.createElement("span", {
    "aria-hidden": "true",
    style: {
      position: 'absolute',
      right: 12,
      top: '50%',
      transform: 'translateY(-50%)',
      pointerEvents: 'none',
      color: 'var(--text-muted)',
      font: 'var(--type-body-sm)'
    }
  }, "\u25BE"));
}
Object.assign(__ds_scope, { Select });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Select.jsx", error: String((e && e.message) || e) }); }

// components/forms/Switch.jsx
try { (() => {
function Switch({
  checked,
  defaultChecked,
  label,
  disabled = false,
  onChange,
  style
}) {
  const isControlled = checked !== undefined;
  const [inner, setInner] = React.useState(!!defaultChecked);
  const on = isControlled ? checked : inner;
  const toggle = () => {
    if (disabled) return;
    if (!isControlled) setInner(!on);
    onChange && onChange(!on);
  };
  return /*#__PURE__*/React.createElement("label", {
    onClick: toggle,
    style: {
      display: 'inline-flex',
      gap: 'var(--space-3)',
      alignItems: 'center',
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? .5 : 1,
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    role: "switch",
    "aria-checked": on,
    style: {
      width: 42,
      height: 24,
      borderRadius: 'var(--radius-pill)',
      padding: 2,
      flex: '0 0 auto',
      background: on ? 'var(--chs-green)' : 'var(--chs-black-20)',
      transition: 'background-color var(--duration-base) var(--ease-standard)',
      display: 'block'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 20,
      height: 20,
      borderRadius: 'var(--radius-circle)',
      background: 'var(--chs-white)',
      display: 'block',
      transform: 'translateX(' + (on ? 18 : 0) + 'px)',
      transition: 'transform var(--duration-base) var(--ease-out)',
      boxShadow: '0 1px 2px rgba(29,29,29,.3)'
    }
  })), label && /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--type-body)',
      color: 'var(--text-strong)'
    }
  }, label));
}
Object.assign(__ds_scope, { Switch });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Switch.jsx", error: String((e && e.message) || e) }); }

// components/forms/Textarea.jsx
try { (() => {
function Textarea({
  value,
  defaultValue,
  placeholder,
  rows = 4,
  disabled = false,
  invalid = false,
  onChange,
  id,
  style
}) {
  const [focus, setFocus] = React.useState(false);
  return /*#__PURE__*/React.createElement("textarea", {
    id: id,
    rows: rows,
    value: value,
    defaultValue: defaultValue,
    placeholder: placeholder,
    disabled: disabled,
    onChange: onChange,
    onFocus: () => setFocus(true),
    onBlur: () => setFocus(false),
    style: {
      font: 'var(--type-body)',
      color: 'var(--text-strong)',
      padding: '10px 12px',
      resize: 'vertical',
      background: disabled ? 'var(--surface-subtle)' : 'var(--surface-card)',
      border: '1px solid ' + (invalid ? 'var(--status-critical)' : focus ? 'var(--border-focus)' : 'var(--border-hairline)'),
      borderRadius: 'var(--radius-md)',
      boxShadow: focus ? 'var(--focus-ring)' : 'none',
      outline: 'none',
      transition: 'var(--transition-control)',
      width: '100%',
      ...style
    }
  });
}
Object.assign(__ds_scope, { Textarea });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Textarea.jsx", error: String((e && e.message) || e) }); }

// components/navigation/Breadcrumbs.jsx
try { (() => {
function Breadcrumbs({
  items = [],
  style
}) {
  return /*#__PURE__*/React.createElement("nav", {
    "aria-label": "Breadcrumb",
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-2)',
      font: 'var(--type-body-sm)',
      flexWrap: 'wrap',
      ...style
    }
  }, items.map((it, i) => {
    const last = i === items.length - 1;
    return /*#__PURE__*/React.createElement("span", {
      key: it.label + i,
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--space-2)'
      }
    }, last ? /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--text-muted)'
      }
    }, it.label) : /*#__PURE__*/React.createElement("a", {
      href: it.href || '#',
      style: {
        color: 'var(--text-link)'
      }
    }, it.label), !last && /*#__PURE__*/React.createElement("span", {
      "aria-hidden": "true",
      style: {
        color: 'var(--chs-black-40)'
      }
    }, "/"));
  }));
}
Object.assign(__ds_scope, { Breadcrumbs });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/Breadcrumbs.jsx", error: String((e && e.message) || e) }); }

// components/navigation/Pagination.jsx
try { (() => {
function Pagination({
  page = 1,
  pages = 1,
  onChange,
  style
}) {
  const go = p => {
    if (p >= 1 && p <= pages && onChange) onChange(p);
  };
  const btn = on => ({
    minWidth: 34,
    height: 34,
    borderRadius: 'var(--radius-md)',
    cursor: 'pointer',
    font: on ? 'var(--type-body-strong)' : 'var(--type-body)',
    background: on ? 'var(--chs-purple)' : 'transparent',
    color: on ? 'var(--text-inverse)' : 'var(--text-body)',
    border: '1px solid ' + (on ? 'var(--chs-purple)' : 'var(--border-hairline)'),
    transition: 'var(--transition-control)'
  });
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-2)',
      ...style
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => go(page - 1),
    disabled: page === 1,
    style: {
      ...btn(false),
      opacity: page === 1 ? .4 : 1,
      padding: '0 12px'
    }
  }, "Previous"), Array.from({
    length: pages
  }, (_, i) => i + 1).map(p => /*#__PURE__*/React.createElement("button", {
    key: p,
    onClick: () => go(p),
    style: btn(p === page)
  }, p)), /*#__PURE__*/React.createElement("button", {
    onClick: () => go(page + 1),
    disabled: page === pages,
    style: {
      ...btn(false),
      opacity: page === pages ? .4 : 1,
      padding: '0 12px'
    }
  }, "Next"));
}
Object.assign(__ds_scope, { Pagination });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/Pagination.jsx", error: String((e && e.message) || e) }); }

// components/navigation/Tabs.jsx
try { (() => {
function Tabs({
  tabs = [],
  value,
  onChange,
  variant = 'underline',
  style
}) {
  const active = value !== undefined ? value : tabs[0] && (typeof tabs[0] === 'string' ? tabs[0] : tabs[0].value);
  return /*#__PURE__*/React.createElement("div", {
    role: "tablist",
    style: {
      display: 'flex',
      gap: variant === 'pill' ? 'var(--space-2)' : 'var(--space-6)',
      borderBottom: variant === 'underline' ? '1px solid var(--border-subtle)' : 'none',
      ...style
    }
  }, tabs.map(t => {
    const tab = typeof t === 'string' ? {
      value: t,
      label: t
    } : t;
    const on = tab.value === active;
    const pill = {
      padding: '8px 16px',
      borderRadius: 'var(--radius-pill)',
      background: on ? 'var(--chs-purple)' : 'transparent',
      color: on ? 'var(--text-inverse)' : 'var(--text-body)',
      border: '1px solid ' + (on ? 'var(--chs-purple)' : 'var(--border-hairline)')
    };
    const underline = {
      padding: '10px 0 12px',
      borderBottom: '3px solid ' + (on ? 'var(--chs-purple)' : 'transparent'),
      color: on ? 'var(--text-strong)' : 'var(--text-muted)',
      marginBottom: -1
    };
    return /*#__PURE__*/React.createElement("button", {
      key: tab.value,
      role: "tab",
      "aria-selected": on,
      onClick: () => onChange && onChange(tab.value),
      style: {
        background: 'none',
        cursor: 'pointer',
        font: on ? 'var(--type-body-strong)' : 'var(--type-body)',
        transition: 'var(--transition-control)',
        ...(variant === 'pill' ? pill : underline)
      }
    }, tab.label, tab.count !== undefined && /*#__PURE__*/React.createElement("span", {
      style: {
        opacity: .6,
        marginLeft: 6
      }
    }, tab.count));
  }));
}
Object.assign(__ds_scope, { Tabs });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/Tabs.jsx", error: String((e && e.message) || e) }); }

// ui_kits/stationery/Stationery.jsx
try { (() => {
const {
  Logo,
  StripeRule,
  Icon
} = window.ConnectedHealthcareSystemsDesignSystem_914962;
const CONTACT = {
  name: 'Preston Gash',
  role: 'Business Manager',
  phone: '0800 424 797',
  fax: '+64 9 929 3241',
  email: 'Preston.Gash@chsnz.co.nz',
  address: '6C Jack Conway Ave, Manukau, 2104',
  web: 'www.chsnz.co.nz'
};

/* Running body copy in printed documents is justified; headings, addresses and sign-offs are not. */
const JUSTIFY = {
  textAlign: 'justify',
  textWrap: 'pretty',
  hyphens: 'auto'
};

/* A4 letterhead — ghost graphic at 5% per the guidelines. */
function Letterhead() {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      width: 595,
      height: 842,
      background: 'var(--chs-white)',
      position: 'relative',
      overflow: 'hidden',
      boxShadow: 'var(--shadow-card)'
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: "../../assets/logo-mark.png",
    alt: "",
    style: {
      position: 'absolute',
      left: '-14%',
      bottom: '-8%',
      width: '78%',
      opacity: 'var(--ghost-opacity-print)'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      padding: '46px 52px 0'
    }
  }, /*#__PURE__*/React.createElement(Logo, {
    width: 190,
    assetBase: "../../assets",
    clearSpace: false
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 64,
      font: 'var(--type-body-sm)',
      color: 'var(--text-body)',
      lineHeight: 1.7,
      maxWidth: 400
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      font: 'var(--type-body-strong)',
      color: 'var(--text-strong)'
    }
  }, "Charge Nurse Manager"), "Intensive Care Unit", /*#__PURE__*/React.createElement("br", null), "Middlemore Hospital", /*#__PURE__*/React.createElement("br", null), "\u014Ct\u0101huhu, Auckland", /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 26,
      color: 'var(--text-muted)'
    }
  }, "5 August 2026"), /*#__PURE__*/React.createElement("p", {
    style: {
      marginTop: 26
    }
  }, "Dear Aroha,"), /*#__PURE__*/React.createElement("p", {
    style: JUSTIFY
  }, "Thank you for the opportunity to quote on patient monitoring for the ICU expansion. Our engineers are based in Auckland, so installation, commissioning and the clinical education programme will all be delivered by the same team you meet this week."), /*#__PURE__*/React.createElement("p", {
    style: JUSTIFY
  }, "I have attached the specification and the proposed education schedule. I will call on Thursday to talk it through."), /*#__PURE__*/React.createElement("p", {
    style: {
      marginTop: 26
    }
  }, "Ng\u0101 mihi,", /*#__PURE__*/React.createElement("br", null), /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--type-body-strong)',
      color: 'var(--text-strong)'
    }
  }, CONTACT.name), /*#__PURE__*/React.createElement("br", null), CONTACT.role))), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      padding: '0 52px 16px',
      font: 'var(--type-caption)',
      color: 'var(--text-muted)'
    }
  }, /*#__PURE__*/React.createElement("span", null, CONTACT.address), /*#__PURE__*/React.createElement("span", null, "General ", CONTACT.phone), /*#__PURE__*/React.createElement("span", null, CONTACT.web)), /*#__PURE__*/React.createElement(StripeRule, {
    thickness: 6
  })));
}

/* 90 x 55 mm business card, both faces. Ghost graphic at 8% on the front. */
function BusinessCard({
  face = 'front'
}) {
  const W = 340,
    H = 208;
  if (face === 'back') {
    return /*#__PURE__*/React.createElement("div", {
      style: {
        width: W,
        height: H,
        background: 'var(--chs-purple)',
        position: 'relative',
        overflow: 'hidden',
        borderRadius: 2,
        boxShadow: 'var(--shadow-card)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }
    }, /*#__PURE__*/React.createElement("img", {
      src: "../../assets/logo-mark-white.png",
      alt: "",
      style: {
        position: 'absolute',
        right: '-16%',
        bottom: '-24%',
        width: '62%',
        opacity: 0.14
      }
    }), /*#__PURE__*/React.createElement(Logo, {
      variant: "reversed",
      width: 196,
      assetBase: "../../assets",
      clearSpace: false
    }));
  }
  return /*#__PURE__*/React.createElement("div", {
    style: {
      width: W,
      height: H,
      background: 'var(--chs-white)',
      position: 'relative',
      overflow: 'hidden',
      borderRadius: 2,
      boxShadow: 'var(--shadow-card)'
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: "../../assets/logo-mark.png",
    alt: "",
    style: {
      position: 'absolute',
      right: '-12%',
      top: '-18%',
      width: '58%',
      opacity: 'var(--ghost-opacity-card)'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      padding: '20px 22px',
      height: '100%',
      display: 'flex',
      flexDirection: 'column'
    }
  }, /*#__PURE__*/React.createElement(Logo, {
    width: 132,
    assetBase: "../../assets",
    clearSpace: false
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 'auto'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      font: 'var(--weight-semibold) 15px/1.2 var(--font-display)',
      color: 'var(--text-strong)'
    }
  }, CONTACT.name), /*#__PURE__*/React.createElement("div", {
    style: {
      font: 'var(--type-caption)',
      color: 'var(--chs-purple)',
      marginTop: 2
    }
  }, CONTACT.role), /*#__PURE__*/React.createElement("div", {
    style: {
      font: 'var(--type-caption)',
      color: 'var(--text-body)',
      marginTop: 10,
      lineHeight: 1.65
    }
  }, CONTACT.phone, " \xA0\xB7\xA0 ", CONTACT.fax, /*#__PURE__*/React.createElement("br", null), CONTACT.email, /*#__PURE__*/React.createElement("br", null), CONTACT.address))), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0
    }
  }, /*#__PURE__*/React.createElement(StripeRule, {
    thickness: 5
  })));
}

/* Email signature — Myriad Pro substitute, no images beyond the logo. */
function EmailSignature() {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--chs-white)',
      padding: 22,
      boxShadow: 'var(--shadow-hairline)',
      width: 460
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 18,
      alignItems: 'flex-start'
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: "../../assets/logo-mark.png",
    alt: "Connected Healthcare Systems",
    style: {
      width: 58
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      font: 'var(--type-body-sm)',
      color: 'var(--text-body)',
      lineHeight: 1.65
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      font: 'var(--weight-semibold) 15px/1.3 var(--font-display)',
      color: 'var(--text-strong)'
    }
  }, CONTACT.name), /*#__PURE__*/React.createElement("div", {
    style: {
      color: 'var(--chs-purple)'
    }
  }, CONTACT.role, " \xB7 Connected Healthcare Systems"), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 8
    }
  }, CONTACT.phone, " \xB7 ", CONTACT.email), /*#__PURE__*/React.createElement("div", {
    style: {
      color: 'var(--text-muted)'
    }
  }, CONTACT.address, " \xB7 ", CONTACT.web))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 16
    }
  }, /*#__PURE__*/React.createElement(StripeRule, {
    thickness: 4
  })));
}

/* Presentation title slide — Mercedes substitute for the headline, reversed logo on purple. */
function TitleSlide() {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      width: 640,
      height: 360,
      background: 'linear-gradient(120deg,#554596 0%,#3d3169 70%,#221c3d 100%)',
      position: 'relative',
      overflow: 'hidden',
      boxShadow: 'var(--shadow-card)'
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: "../../assets/logo-mark-white.png",
    alt: "",
    style: {
      position: 'absolute',
      right: '-6%',
      top: '-16%',
      width: '46%',
      opacity: 0.1
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '44px 44px 0',
      position: 'relative'
    }
  }, /*#__PURE__*/React.createElement(Logo, {
    variant: "reversed",
    width: 150,
    assetBase: "../../assets",
    clearSpace: false
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      font: 'var(--type-overline)',
      letterSpacing: 'var(--tracking-overline)',
      textTransform: 'uppercase',
      color: 'var(--chs-green-60)',
      marginTop: 46
    }
  }, "ICU expansion \xB7 August 2026"), /*#__PURE__*/React.createElement("div", {
    style: {
      font: 'var(--weight-semibold) 40px/1.1 var(--font-display)',
      color: 'var(--text-inverse)',
      marginTop: 12,
      maxWidth: 470,
      letterSpacing: 'var(--tracking-display)'
    }
  }, "Patient monitoring, supported in region"), /*#__PURE__*/React.createElement("div", {
    style: {
      font: 'var(--type-body)',
      color: 'rgba(255,255,255,.8)',
      marginTop: 14
    }
  }, "Prepared for Middlemore Hospital")), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0
    }
  }, /*#__PURE__*/React.createElement(StripeRule, {
    thickness: 6
  })));
}
Object.assign(window, {
  Letterhead,
  BusinessCard,
  EmailSignature,
  TitleSlide,
  CHS_CONTACT: CONTACT
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/stationery/Stationery.jsx", error: String((e && e.message) || e) }); }

// ui_kits/website/WebChrome.jsx
try { (() => {
const {
  Button,
  IconButton,
  Icon,
  StripeRule,
  Logo
} = window.ConnectedHealthcareSystemsDesignSystem_914962;
const NAV = [{
  label: 'Home',
  view: 'home'
}, {
  label: 'Solutions',
  view: 'solutions',
  menu: ['Patient Monitoring', "Defibrillators and AED's", 'Electrocardiography', 'Surgical', 'Anaesthesia', 'Ventilation', 'Vocera Voice']
}, {
  label: 'Education',
  view: 'education',
  menu: ['Mindray A9 Anaesthesia System', 'Mindray Patient Monitoring', 'Mindray AED', 'Mindray Ventilator', 'Mindray ECG', 'Mindray VS9', 'Mindray D30/D60 Defibrillator', 'Vocera']
}, {
  label: 'About Us',
  view: 'about'
}, {
  label: 'Contact Us',
  view: 'contact'
}];
function WebHeader({
  view,
  onNavigate
}) {
  const [open, setOpen] = React.useState(null);
  return /*#__PURE__*/React.createElement("header", {
    style: {
      position: 'sticky',
      top: 0,
      zIndex: 30,
      background: 'var(--surface-page)',
      boxShadow: 'var(--shadow-card)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 'var(--container-max)',
      margin: '0 auto',
      padding: '0 var(--gutter)',
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-8)',
      height: 92
    }
  }, /*#__PURE__*/React.createElement("a", {
    href: "#",
    onClick: e => {
      e.preventDefault();
      onNavigate('home');
    },
    style: {
      display: 'block'
    }
  }, /*#__PURE__*/React.createElement(Logo, {
    width: 176,
    assetBase: "../../assets",
    clearSpace: false
  })), /*#__PURE__*/React.createElement("nav", {
    style: {
      display: 'flex',
      gap: 'var(--space-6)',
      marginLeft: 'auto',
      alignItems: 'center'
    }
  }, NAV.map(item => /*#__PURE__*/React.createElement("div", {
    key: item.label,
    style: {
      position: 'relative'
    },
    onMouseEnter: () => setOpen(item.menu ? item.label : null),
    onMouseLeave: () => setOpen(null)
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => onNavigate(item.view),
    style: {
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      padding: '8px 0',
      font: view === item.view ? 'var(--type-body-strong)' : 'var(--type-body)',
      color: view === item.view ? 'var(--chs-purple)' : 'var(--text-body)',
      borderBottom: '2px solid ' + (view === item.view ? 'var(--chs-purple)' : 'transparent'),
      transition: 'var(--transition-control)',
      display: 'flex',
      alignItems: 'center',
      gap: 5
    }
  }, item.label, item.menu && /*#__PURE__*/React.createElement(Icon, {
    name: "chevron-down",
    size: 14
  })), item.menu && open === item.label && /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      top: '100%',
      left: -14,
      minWidth: 268,
      background: 'var(--surface-card)',
      boxShadow: 'var(--shadow-overlay)',
      borderRadius: 'var(--radius-md)',
      overflow: 'hidden',
      paddingTop: 4
    }
  }, /*#__PURE__*/React.createElement(StripeRule, {
    thickness: 4
  }), item.menu.map(m => /*#__PURE__*/React.createElement("button", {
    key: m,
    onClick: () => {
      setOpen(null);
      onNavigate(item.view, m);
    },
    style: {
      display: 'block',
      width: '100%',
      textAlign: 'left',
      padding: '10px 16px',
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      font: 'var(--type-body-sm)',
      color: 'var(--text-body)'
    },
    onMouseEnter: e => {
      e.currentTarget.style.background = 'var(--surface-subtle)';
      e.currentTarget.style.color = 'var(--chs-purple)';
    },
    onMouseLeave: e => {
      e.currentTarget.style.background = 'none';
      e.currentTarget.style.color = 'var(--text-body)';
    }
  }, m))))), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'flex',
      gap: 'var(--space-1)',
      marginLeft: 'var(--space-4)',
      paddingLeft: 'var(--space-4)',
      borderLeft: '1px solid var(--border-subtle)'
    }
  }, ['instagram', 'linkedin', 'facebook', 'youtube'].map(s => /*#__PURE__*/React.createElement(IconButton, {
    key: s,
    label: s,
    size: "sm"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: s,
    size: 16
  })))))), /*#__PURE__*/React.createElement(StripeRule, {
    thickness: 4
  }));
}
function WebFooter({
  onNavigate
}) {
  const col = (title, links) => /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-2)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "chs-overline",
    style: {
      color: 'rgba(255,255,255,.55)',
      marginBottom: 'var(--space-2)'
    }
  }, title), links.map(l => /*#__PURE__*/React.createElement("a", {
    key: l,
    href: "#",
    onClick: e => e.preventDefault(),
    style: {
      font: 'var(--type-body-sm)',
      color: 'rgba(255,255,255,.82)'
    }
  }, l)));
  return /*#__PURE__*/React.createElement("footer", {
    style: {
      background: 'var(--surface-inverse)',
      color: 'var(--text-inverse)',
      position: 'relative',
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement(StripeRule, {
    thickness: 5
  }), /*#__PURE__*/React.createElement("img", {
    src: "../../assets/logo-mark-white.png",
    alt: "",
    style: {
      position: 'absolute',
      right: -40,
      bottom: -80,
      width: 360,
      opacity: 0.06,
      pointerEvents: 'none'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 'var(--container-max)',
      margin: '0 auto',
      padding: '56px var(--gutter) 40px',
      display: 'grid',
      gridTemplateColumns: '1.4fr 1fr 1fr 1fr',
      gap: 'var(--space-10)',
      position: 'relative'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(Logo, {
    variant: "reversed",
    width: 190,
    assetBase: "../../assets",
    clearSpace: false
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      font: 'var(--type-body-sm)',
      color: 'rgba(255,255,255,.82)',
      marginTop: 'var(--space-5)',
      lineHeight: 1.7
    }
  }, "6C Jack Conway Avenue,", /*#__PURE__*/React.createElement("br", null), "Manukau, Auckland 2104", /*#__PURE__*/React.createElement("br", null), /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--type-body-strong)',
      color: 'var(--chs-green-60)'
    }
  }, "0800 424 797"))), col('Solutions', ['Mindray Patient Monitoring', 'Mindray Anaesthesia Machines', 'Mindray Ventilation', 'Vocera Voice']), col('Education', ['Mindray Patient Monitoring', 'Mindray Ventilation', 'Mindray ECG', 'Vocera Voice']), col('Connected Healthcare', ['About Us', 'Contact Us'])), /*#__PURE__*/React.createElement("div", {
    style: {
      borderTop: '1px solid rgba(255,255,255,.12)',
      padding: '18px var(--gutter)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 'var(--container-max)',
      margin: '0 auto',
      display: 'flex',
      justifyContent: 'space-between',
      font: 'var(--type-caption)',
      color: 'rgba(255,255,255,.5)'
    }
  }, /*#__PURE__*/React.createElement("span", null, "\xA9 Connected Healthcare Systems. New Zealand owned and operated."), /*#__PURE__*/React.createElement("span", null, "www.chsnz.co.nz"))));
}
Object.assign(window, {
  WebHeader,
  WebFooter,
  WEB_NAV: NAV
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/website/WebChrome.jsx", error: String((e && e.message) || e) }); }

// ui_kits/website/WebHome.jsx
try { (() => {
const {
  Button,
  Card,
  Badge,
  Icon,
  StripeRule,
  Alert
} = window.ConnectedHealthcareSystemsDesignSystem_914962;
const SOLUTIONS = [{
  name: 'Patient Monitoring',
  icon: 'activity',
  copy: 'Mindray bedside, transport and central monitoring for wards, theatre and ICU.',
  accent: 'purple'
}, {
  name: "Defibrillators and AED's",
  icon: 'zap',
  copy: 'D-series defibrillators and AEDs for hospital and community response.',
  accent: 'orange'
}, {
  name: 'Electrocardiography',
  icon: 'heart-pulse',
  copy: 'Resting and stress ECG systems with NZ-based service cover.',
  accent: 'green'
}, {
  name: 'Surgical',
  icon: 'scissors',
  copy: 'Theatre lighting, tables and integration for perioperative teams.',
  accent: 'purple'
}, {
  name: 'Anaesthesia',
  icon: 'wind',
  copy: 'The Mindray A-series anaesthesia workstations, including the A9.',
  accent: 'green'
}, {
  name: 'Ventilation',
  icon: 'lungs',
  copy: 'Invasive and non-invasive ventilation for critical care and transport.',
  accent: 'orange'
}];
function WebHero({
  onNavigate
}) {
  return /*#__PURE__*/React.createElement("section", {
    style: {
      position: 'relative',
      background: 'linear-gradient(90deg,#554596 0%,#453873 62%,#2a2247 100%)',
      color: 'var(--text-inverse)',
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: "../../assets/logo-mark-white.png",
    alt: "",
    style: {
      position: 'absolute',
      right: '2%',
      top: '-14%',
      width: 460,
      opacity: 0.08
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 'var(--container-max)',
      margin: '0 auto',
      padding: '84px var(--gutter) 92px',
      position: 'relative',
      maxWidth: 'var(--container-max)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 720
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "chs-overline",
    style: {
      color: 'var(--chs-green-60)'
    }
  }, "New Zealand owned and operated"), /*#__PURE__*/React.createElement("h1", {
    style: {
      font: 'var(--type-display-1)',
      color: 'var(--text-inverse)',
      letterSpacing: 'var(--tracking-display)',
      margin: 'var(--space-4) 0 var(--space-5)'
    }
  }, "Improving healthcare outcomes for Kiwis"), /*#__PURE__*/React.createElement("p", {
    style: {
      font: 'var(--type-body-lg)',
      color: 'rgba(255,255,255,.86)',
      maxWidth: 620
    }
  }, "36 NZ-based staff, strategically located across the country. In-region accountability, rapid response and deep clinical understanding \u2014 without the latency of offshore engineering or technical assistance."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 'var(--space-3)',
      marginTop: 'var(--space-8)'
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "inverse",
    size: "lg",
    onClick: () => onNavigate('solutions'),
    iconRight: /*#__PURE__*/React.createElement(Icon, {
      name: "arrow-right",
      size: 18
    })
  }, "Explore solutions"), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    tone: "green",
    size: "lg",
    style: {
      color: 'var(--chs-green-60)',
      borderColor: 'var(--chs-green-60)'
    },
    onClick: () => onNavigate('contact')
  }, "Talk to our team")))));
}
function WebPartnerStrip() {
  return /*#__PURE__*/React.createElement("section", {
    style: {
      background: 'var(--surface-subtle)',
      padding: '36px var(--gutter)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 'var(--container-max)',
      margin: '0 auto',
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-10)',
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "chs-overline"
  }, "Distributed in New Zealand by Connected"), ['Mindray', 'Vocera'].map(p => /*#__PURE__*/React.createElement("div", {
    key: p,
    style: {
      font: 'var(--weight-semibold) 26px/1 var(--font-display)',
      color: 'var(--chs-black-60)',
      letterSpacing: '.02em'
    }
  }, p)), /*#__PURE__*/React.createElement("div", {
    style: {
      font: 'var(--type-caption)',
      color: 'var(--text-muted)',
      marginLeft: 'auto',
      maxWidth: 300
    }
  }, "Partner logos are third-party marks and are not included in this design system \u2014 set in type as a placeholder.")));
}
function WebSolutionsGrid({
  onNavigate,
  heading = 'Our solutions',
  intro
}) {
  return /*#__PURE__*/React.createElement("section", {
    style: {
      padding: 'var(--section-y) var(--gutter)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 'var(--container-max)',
      margin: '0 auto'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "chs-overline"
  }, "Solutions"), /*#__PURE__*/React.createElement("h2", {
    style: {
      font: 'var(--type-h1)',
      margin: 'var(--space-3) 0 var(--space-4)'
    }
  }, heading), intro && /*#__PURE__*/React.createElement("p", {
    style: {
      font: 'var(--type-body-lg)',
      maxWidth: 680
    }
  }, intro), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3,1fr)',
      gap: 'var(--space-6)',
      marginTop: 'var(--space-8)'
    }
  }, SOLUTIONS.map(s => /*#__PURE__*/React.createElement(Card, {
    key: s.name,
    accent: s.accent,
    interactive: true,
    onClick: () => onNavigate('product', s.name)
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--chs-' + s.accent + ')',
      display: 'flex',
      marginBottom: 'var(--space-4)'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: s.icon,
    size: 28
  })), /*#__PURE__*/React.createElement("h3", {
    style: {
      font: 'var(--type-h3)'
    }
  }, s.name), /*#__PURE__*/React.createElement("p", {
    style: {
      font: 'var(--type-body-sm)',
      margin: 'var(--space-2) 0 var(--space-4)'
    }
  }, s.copy), /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--type-body-strong)',
      color: 'var(--chs-purple)',
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6
    }
  }, "Learn more ", /*#__PURE__*/React.createElement(Icon, {
    name: "arrow-right",
    size: 16
  })))))));
}
function WebVoceraBlock({
  onNavigate
}) {
  return /*#__PURE__*/React.createElement("section", {
    style: {
      background: 'var(--surface-subtle)',
      padding: 'var(--section-y) var(--gutter)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 'var(--container-max)',
      margin: '0 auto',
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 'var(--space-16)',
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "chs-overline"
  }, "Vocera Voice"), /*#__PURE__*/React.createElement("h2", {
    style: {
      font: 'var(--type-h1)',
      margin: 'var(--space-3) 0 var(--space-4)'
    }
  }, "Hands-free communication for clinical teams"), /*#__PURE__*/React.createElement("p", {
    style: {
      font: 'var(--type-body)'
    }
  }, "Vocera Communication focuses on delivering technology that is specific to the healthcare environment, improving communication and collaboration between clinical, administrative and support personnel, particularly in Hospital and Residential Aged Care settings."), /*#__PURE__*/React.createElement("p", {
    style: {
      font: 'var(--type-body)'
    }
  }, "Using Wi-Fi technology, Vocera can be used as a pager, telephone, nurse call, monitor alarm management, and secure SMS messaging."), /*#__PURE__*/React.createElement(Button, {
    tone: "green",
    onClick: () => onNavigate('product', 'Vocera Voice'),
    iconRight: /*#__PURE__*/React.createElement(Icon, {
      name: "arrow-right",
      size: 16
    })
  }, "See Vocera Voice")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 'var(--space-4)'
    }
  }, [['radio', 'Speak a name, function or group', 'purple'], ['bell', 'Nurse call and monitor alarm routing', 'green'], ['message-square', 'Secure text to any device of choice', 'orange']].map(([icon, label, tone]) => /*#__PURE__*/React.createElement(Card, {
    key: label,
    variant: "outlined",
    padding: "var(--space-5)"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 'var(--space-4)',
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 44,
      height: 44,
      borderRadius: 'var(--radius-circle)',
      background: 'var(--chs-' + tone + '-20)',
      color: 'var(--chs-' + tone + ')',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flex: '0 0 auto'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: icon,
    size: 20
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      font: 'var(--type-h4)'
    }
  }, label)))))));
}
function WebStats() {
  return /*#__PURE__*/React.createElement("section", {
    style: {
      padding: '0 var(--gutter) var(--section-y)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 'var(--container-max)',
      margin: '0 auto',
      display: 'grid',
      gridTemplateColumns: 'repeat(4,1fr)',
      gap: 'var(--space-6)'
    }
  }, [['36', 'NZ-based staff'], ['100%', 'NZ owned and operated'], ['8', 'Education programmes'], ['0800 424 797', 'One number, nationwide']].map(([v, l]) => /*#__PURE__*/React.createElement("div", {
    key: l,
    style: {
      borderTop: '3px solid var(--chs-purple)',
      paddingTop: 'var(--space-4)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      font: 'var(--weight-semibold) 34px/1.1 var(--font-display)',
      color: 'var(--text-strong)'
    }
  }, v), /*#__PURE__*/React.createElement("div", {
    style: {
      font: 'var(--type-body-sm)',
      color: 'var(--text-muted)',
      marginTop: 4
    }
  }, l)))));
}
Object.assign(window, {
  WebHero,
  WebPartnerStrip,
  WebSolutionsGrid,
  WebVoceraBlock,
  WebStats,
  WEB_SOLUTIONS: SOLUTIONS
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/website/WebHome.jsx", error: String((e && e.message) || e) }); }

// ui_kits/website/WebPages.jsx
try { (() => {
const {
  Button,
  Card,
  Badge,
  Tag,
  Icon,
  Tabs,
  Breadcrumbs,
  Alert,
  Field,
  Input,
  Textarea,
  Select,
  Checkbox,
  StripeRule,
  Toast,
  Dialog
} = window.ConnectedHealthcareSystemsDesignSystem_914962;
function WebProduct({
  name = 'Patient Monitoring',
  onNavigate
}) {
  const [tab, setTab] = React.useState('Overview');
  const specs = [['Range', 'Bedside, transport and central station'], ['Parameters', 'ECG, SpO₂, NIBP, IBP, temperature, capnography'], ['Service', 'NZ-based biomedical engineers, Manukau workshop'], ['Training', 'On-site clinical education included']];
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--surface-subtle)',
      padding: '28px var(--gutter) 0'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 'var(--container-max)',
      margin: '0 auto'
    }
  }, /*#__PURE__*/React.createElement(Breadcrumbs, {
    items: [{
      label: 'Home',
      href: '#'
    }, {
      label: 'Solutions',
      href: '#'
    }, {
      label: name
    }]
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1.1fr 1fr',
      gap: 'var(--space-12)',
      alignItems: 'center',
      padding: '32px 0 44px'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(Badge, {
    tone: "purple"
  }, "Mindray"), /*#__PURE__*/React.createElement("h1", {
    style: {
      font: 'var(--type-display-2)',
      margin: 'var(--space-4) 0 var(--space-4)'
    }
  }, name), /*#__PURE__*/React.createElement("p", {
    style: {
      font: 'var(--type-body-lg)'
    }
  }, "Mindray manufactures state of the art patient monitoring, ventilation and anaesthesia equipment. We are pleased to be the New Zealand Distributor for their products."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 'var(--space-3)',
      marginTop: 'var(--space-6)'
    }
  }, /*#__PURE__*/React.createElement(Button, {
    onClick: () => onNavigate('contact')
  }, "Request a quote"), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    iconLeft: /*#__PURE__*/React.createElement(Icon, {
      name: "download",
      size: 16
    })
  }, "Datasheet"))), /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--surface-card)',
      borderRadius: 'var(--radius-card)',
      boxShadow: 'var(--shadow-card)',
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement(StripeRule, {
    thickness: 5
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      height: 240,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'column',
      gap: 'var(--space-2)',
      color: 'var(--text-disabled)'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "image",
    size: 32
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--type-caption)'
    }
  }, "Product photography not supplied")))), /*#__PURE__*/React.createElement(Tabs, {
    tabs: ['Overview', 'Specifications', 'Education', 'Support'],
    value: tab,
    onChange: setTab
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 'var(--container-max)',
      margin: '0 auto',
      padding: 'var(--section-y-sm) var(--gutter) var(--section-y)'
    }
  }, tab === 'Overview' && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1.4fr 1fr',
      gap: 'var(--space-12)'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h2", {
    style: {
      font: 'var(--type-h2)',
      marginBottom: 'var(--space-4)'
    }
  }, "Supported in region"), /*#__PURE__*/React.createElement("p", {
    style: {
      font: 'var(--type-body)'
    }
  }, "Our engineers and clinical educators are based here, so a fault call, a software update or a training session happens on New Zealand time. That means in-region accountability, rapid response and deep clinical understanding."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 'var(--space-4)',
      marginTop: 'var(--space-6)'
    }
  }, [['map-pin', 'Engineers in every region'], ['clock', 'Response on NZ time'], ['graduation-cap', 'Clinical education included'], ['wrench', 'Manukau service workshop']].map(([i, l]) => /*#__PURE__*/React.createElement("div", {
    key: l,
    style: {
      display: 'flex',
      gap: 'var(--space-3)',
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--chs-green)',
      display: 'flex'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: i,
    size: 18
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--type-body-sm)',
      color: 'var(--text-strong)'
    }
  }, l))))), /*#__PURE__*/React.createElement(Card, {
    variant: "tinted",
    ghost: true,
    assetBase: "../../assets"
  }, /*#__PURE__*/React.createElement("div", {
    className: "chs-overline"
  }, "Talk to a specialist"), /*#__PURE__*/React.createElement("div", {
    style: {
      font: 'var(--type-h3)',
      margin: 'var(--space-2) 0 var(--space-3)'
    }
  }, "0800 424 797"), /*#__PURE__*/React.createElement("p", {
    style: {
      font: 'var(--type-body-sm)'
    }
  }, "6C Jack Conway Avenue, Manukau, Auckland 2104"), /*#__PURE__*/React.createElement(Button, {
    block: true,
    onClick: () => onNavigate('contact')
  }, "Send an enquiry"))), tab === 'Specifications' && /*#__PURE__*/React.createElement("table", {
    style: {
      width: '100%',
      borderCollapse: 'collapse',
      maxWidth: 820
    }
  }, /*#__PURE__*/React.createElement("tbody", null, specs.map(([k, v]) => /*#__PURE__*/React.createElement("tr", {
    key: k,
    style: {
      borderBottom: '1px solid var(--border-subtle)'
    }
  }, /*#__PURE__*/React.createElement("th", {
    style: {
      textAlign: 'left',
      padding: '14px 0',
      width: 200,
      font: 'var(--type-body-strong)',
      color: 'var(--text-strong)'
    }
  }, k), /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '14px 0',
      font: 'var(--type-body)'
    }
  }, v))))), tab === 'Education' && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-4)',
      maxWidth: 820
    }
  }, /*#__PURE__*/React.createElement(Alert, {
    tone: "info",
    title: "Education is included",
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "info",
      size: 16
    })
  }, "Every install comes with an on-site programme for your ward."), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    onClick: () => onNavigate('education'),
    iconRight: /*#__PURE__*/React.createElement(Icon, {
      name: "arrow-right",
      size: 16
    })
  }, "Go to the education hub")), tab === 'Support' && /*#__PURE__*/React.createElement(Alert, {
    tone: "warning",
    title: "Service and faults",
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "wrench",
      size: 16
    })
  }, "Call 0800 424 797, or email service@chsnz.co.nz with the model and serial number.")));
}
const COURSES = [{
  name: 'Mindray A9 Anaesthesia System',
  cat: 'Anaesthesia',
  mins: 45,
  level: 'Core',
  tone: 'purple'
}, {
  name: 'Mindray Patient Monitoring',
  cat: 'Monitoring',
  mins: 60,
  level: 'Core',
  tone: 'purple'
}, {
  name: 'Mindray AED',
  cat: 'Resuscitation',
  mins: 25,
  level: 'Refresher',
  tone: 'green'
}, {
  name: 'Mindray Ventilator',
  cat: 'Ventilation',
  mins: 55,
  level: 'Advanced',
  tone: 'orange'
}, {
  name: 'Mindray ECG',
  cat: 'Diagnostics',
  mins: 30,
  level: 'Core',
  tone: 'green'
}, {
  name: 'Mindray VS9',
  cat: 'Monitoring',
  mins: 35,
  level: 'Core',
  tone: 'purple'
}, {
  name: 'Mindray D30/D60 Defibrillator',
  cat: 'Resuscitation',
  mins: 40,
  level: 'Advanced',
  tone: 'orange'
}, {
  name: 'Vocera',
  cat: 'Communications',
  mins: 30,
  level: 'Core',
  tone: 'green'
}];
function WebEducation({
  onBook
}) {
  const [filter, setFilter] = React.useState('All');
  const [q, setQ] = React.useState('');
  const cats = ['All', ...Array.from(new Set(COURSES.map(c => c.cat)))];
  const list = COURSES.filter(c => (filter === 'All' || c.cat === filter) && c.name.toLowerCase().includes(q.toLowerCase()));
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--chs-green-20)',
      padding: '52px var(--gutter)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 'var(--container-max)',
      margin: '0 auto'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "chs-overline",
    style: {
      color: '#5b8801'
    }
  }, "Education"), /*#__PURE__*/React.createElement("h1", {
    style: {
      font: 'var(--type-display-2)',
      margin: 'var(--space-3) 0 var(--space-3)'
    }
  }, "Training built around your ward"), /*#__PURE__*/React.createElement("p", {
    style: {
      font: 'var(--type-body-lg)',
      maxWidth: 640
    }
  }, "Eight programmes, delivered on site by NZ-based clinical educators or online at your own pace."))), /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 'var(--container-max)',
      margin: '0 auto',
      padding: 'var(--section-y-sm) var(--gutter) var(--section-y)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 'var(--space-4)',
      alignItems: 'center',
      flexWrap: 'wrap',
      marginBottom: 'var(--space-6)'
    }
  }, /*#__PURE__*/React.createElement(Input, {
    placeholder: "Search programmes",
    value: q,
    onChange: e => setQ(e.target.value),
    iconLeft: /*#__PURE__*/React.createElement(Icon, {
      name: "search",
      size: 16
    }),
    style: {
      width: 280
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 'var(--space-2)',
      flexWrap: 'wrap'
    }
  }, cats.map(c => /*#__PURE__*/React.createElement(Tag, {
    key: c,
    selected: filter === c,
    onClick: () => setFilter(c)
  }, c)))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3,1fr)',
      gap: 'var(--space-6)'
    }
  }, list.map(c => /*#__PURE__*/React.createElement(Card, {
    key: c.name,
    accent: c.tone,
    interactive: true,
    onClick: () => onBook(c)
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement(Badge, {
    tone: c.tone
  }, c.level), /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--type-caption)',
      color: 'var(--text-muted)',
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "clock",
    size: 13
  }), c.mins, " min")), /*#__PURE__*/React.createElement("h3", {
    style: {
      font: 'var(--type-h4)',
      marginTop: 'var(--space-4)'
    }
  }, c.name), /*#__PURE__*/React.createElement("p", {
    style: {
      font: 'var(--type-body-sm)',
      color: 'var(--text-muted)',
      margin: 'var(--space-2) 0 var(--space-4)'
    }
  }, c.cat), /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--type-body-strong)',
      color: 'var(--chs-purple)',
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6
    }
  }, "Book a session ", /*#__PURE__*/React.createElement(Icon, {
    name: "arrow-right",
    size: 16
  }))))), list.length === 0 && /*#__PURE__*/React.createElement("p", {
    style: {
      font: 'var(--type-body)',
      color: 'var(--text-muted)'
    }
  }, "No programmes match that search.")));
}
function WebAbout() {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 'var(--container-narrow)',
      margin: '0 auto',
      padding: 'var(--section-y) var(--gutter)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "chs-overline"
  }, "About us"), /*#__PURE__*/React.createElement("h1", {
    style: {
      font: 'var(--type-display-2)',
      margin: 'var(--space-3) 0 var(--space-6)'
    }
  }, "About us"), /*#__PURE__*/React.createElement("p", {
    style: {
      font: 'var(--type-body-lg)'
    }
  }, "Connected Healthcare Systems is a New Zealand owned and operated Company bringing NZ customers the very latest in high quality medical devices, and technology. Proud to be partnering with Mindray Medical for all your patient monitoring and anaesthesia equipment."), /*#__PURE__*/React.createElement("p", {
    style: {
      font: 'var(--type-body-lg)'
    }
  }, "Also proud to represent Vocera Communication Systems. Our integrated, intelligent system enables users to communicate instantly with each other simply by saying the name, function, or group of the desired recipient, and securely delivers text messages and alerts directly to and from their device of choice."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      margin: 'var(--space-8) 0'
    }
  }, /*#__PURE__*/React.createElement(StripeRule, {
    thickness: 6
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 'var(--space-6)'
    }
  }, /*#__PURE__*/React.createElement(Card, {
    variant: "outlined"
  }, /*#__PURE__*/React.createElement("div", {
    className: "chs-overline"
  }, "Contact"), /*#__PURE__*/React.createElement("div", {
    style: {
      font: 'var(--type-h3)',
      margin: '8px 0'
    }
  }, "Preston Gash"), /*#__PURE__*/React.createElement("p", {
    style: {
      font: 'var(--type-body-sm)'
    }
  }, "Business Manager", /*#__PURE__*/React.createElement("br", null), "Preston.Gash@chsnz.co.nz")), /*#__PURE__*/React.createElement(Card, {
    variant: "outlined"
  }, /*#__PURE__*/React.createElement("div", {
    className: "chs-overline"
  }, "Office"), /*#__PURE__*/React.createElement("div", {
    style: {
      font: 'var(--type-h3)',
      margin: '8px 0'
    }
  }, "0800 424 797"), /*#__PURE__*/React.createElement("p", {
    style: {
      font: 'var(--type-body-sm)'
    }
  }, "6C Jack Conway Avenue, Manukau, Auckland 2104", /*#__PURE__*/React.createElement("br", null), "Fax +64 9 929 3241"))));
}
function WebContact({
  onSubmit
}) {
  const [sent, setSent] = React.useState(false);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 'var(--container-max)',
      margin: '0 auto',
      padding: 'var(--section-y-sm) var(--gutter) var(--section-y)',
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 'var(--space-16)'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "chs-overline"
  }, "Contact us"), /*#__PURE__*/React.createElement("h1", {
    style: {
      font: 'var(--type-display-2)',
      margin: 'var(--space-3) 0 var(--space-4)'
    }
  }, "Talk to someone here"), /*#__PURE__*/React.createElement("p", {
    style: {
      font: 'var(--type-body-lg)'
    }
  }, "Every call is answered in New Zealand. Tell us what you need and we will put the right engineer or educator in front of you."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-4)',
      marginTop: 'var(--space-8)'
    }
  }, [['phone', '0800 424 797'], ['printer', '+64 9 929 3241'], ['map-pin', '6C Jack Conway Avenue, Manukau, Auckland 2104'], ['globe', 'www.chsnz.co.nz']].map(([i, l]) => /*#__PURE__*/React.createElement("div", {
    key: l,
    style: {
      display: 'flex',
      gap: 'var(--space-3)',
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 38,
      height: 38,
      borderRadius: 'var(--radius-circle)',
      background: 'var(--surface-brand-tint)',
      color: 'var(--chs-purple)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flex: '0 0 auto'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: i,
    size: 17
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--type-body)',
      color: 'var(--text-strong)'
    }
  }, l))))), /*#__PURE__*/React.createElement(Card, {
    accent: "stripes"
  }, /*#__PURE__*/React.createElement("form", {
    onSubmit: e => {
      e.preventDefault();
      setSent(true);
      onSubmit && onSubmit();
    },
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-5)'
    }
  }, /*#__PURE__*/React.createElement(Field, {
    label: "Full name",
    required: true
  }, /*#__PURE__*/React.createElement(Input, {
    placeholder: "Aroha Ngata"
  })), /*#__PURE__*/React.createElement(Field, {
    label: "Work email",
    required: true,
    hint: "We reply within one working day."
  }, /*#__PURE__*/React.createElement(Input, {
    type: "email",
    placeholder: "name@healthnz.govt.nz",
    iconLeft: /*#__PURE__*/React.createElement(Icon, {
      name: "mail",
      size: 16
    })
  })), /*#__PURE__*/React.createElement(Field, {
    label: "What is this about?"
  }, /*#__PURE__*/React.createElement(Select, {
    placeholder: "Choose a topic",
    options: ['Patient monitoring', 'Ventilation', 'Anaesthesia', 'Vocera Voice', 'Service or fault', 'Education']
  })), /*#__PURE__*/React.createElement(Field, {
    label: "How can we help?"
  }, /*#__PURE__*/React.createElement(Textarea, {
    rows: 4,
    placeholder: "Tell us about your ward"
  })), /*#__PURE__*/React.createElement(Checkbox, {
    label: "Send me education updates",
    hint: "About four emails a year."
  }), /*#__PURE__*/React.createElement(Button, {
    type: "submit",
    size: "lg",
    block: true
  }, sent ? 'Enquiry sent' : 'Send enquiry'))));
}
Object.assign(window, {
  WebProduct,
  WebEducation,
  WebAbout,
  WebContact,
  WEB_COURSES: COURSES
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/website/WebPages.jsx", error: String((e && e.message) || e) }); }

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Card = __ds_scope.Card;

__ds_ns.Icon = __ds_scope.Icon;

__ds_ns.IconButton = __ds_scope.IconButton;

__ds_ns.Logo = __ds_scope.Logo;

__ds_ns.StripeRule = __ds_scope.StripeRule;

__ds_ns.Tag = __ds_scope.Tag;

__ds_ns.Alert = __ds_scope.Alert;

__ds_ns.Dialog = __ds_scope.Dialog;

__ds_ns.Toast = __ds_scope.Toast;

__ds_ns.Tooltip = __ds_scope.Tooltip;

__ds_ns.Checkbox = __ds_scope.Checkbox;

__ds_ns.Field = __ds_scope.Field;

__ds_ns.Input = __ds_scope.Input;

__ds_ns.RadioGroup = __ds_scope.RadioGroup;

__ds_ns.Select = __ds_scope.Select;

__ds_ns.Switch = __ds_scope.Switch;

__ds_ns.Textarea = __ds_scope.Textarea;

__ds_ns.Breadcrumbs = __ds_scope.Breadcrumbs;

__ds_ns.Pagination = __ds_scope.Pagination;

__ds_ns.Tabs = __ds_scope.Tabs;

})();
