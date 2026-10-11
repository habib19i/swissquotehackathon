/** Token marks, drawn inline: bitcoin, USDC and ETH. Decorative: names are always shown. */
type TokenProps = { size?: number };

export const BtcToken = ({ size = 46 }: TokenProps) => (
  <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
    <circle cx="16" cy="16" r="16" fill="#f7931a" />
    <g transform="rotate(14 16 16)" fill="none" stroke="#fff" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11.5 9h5.75a3.25 3.25 0 0 1 0 6.5H11.5zM11.5 15.5h6.5a3.5 3.5 0 0 1 0 7H11.5zM11.5 9v13.5" />
      <path d="M13.5 6.5V9M16.5 6.5V9M13.5 22.5V25M16.5 22.5V25" />
    </g>
  </svg>
);

export const UsdcToken = ({ size = 46 }: TokenProps) => (
  <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
    <circle cx="16" cy="16" r="16" fill="#2775ca" />
    <g fill="none" stroke="#fff" strokeLinecap="round">
      <path strokeWidth="2" d="M19 12.6c-.3-1.3-1.5-2-3-2-1.8 0-3 .9-3 2.3 0 3.4 6.2 1.9 6.2 5.3 0 1.4-1.3 2.4-3.2 2.4-1.6 0-2.9-.8-3.2-2.1M16 8.5v2.1M16 20.6v2.4" />
      <path strokeWidth="1.8" d="M11.5 7.6a9.6 9.6 0 0 0 0 16.8M20.5 7.6a9.6 9.6 0 0 1 0 16.8" />
    </g>
  </svg>
);

export const EthToken = ({ size = 46 }: TokenProps) => (
  <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
    <circle cx="16" cy="16" r="16" fill="#627eea" />
    <g fill="#fff">
      <path fillOpacity=".6" d="M16.5 4v8.9l7.5 3.3z" />
      <path d="M16.5 4L9 16.2l7.5-3.3z" />
      <path fillOpacity=".6" d="M16.5 22v6l7.5-10.4z" />
      <path d="M16.5 28v-6L9 17.6z" />
      <path fillOpacity=".2" d="M16.5 20.6l7.5-4.4-7.5-3.3z" />
      <path fillOpacity=".6" d="M9 16.2l7.5 4.4v-7.7z" />
    </g>
  </svg>
);

/** A DeFi app's monogram: its initial on its colour (no third-party logos). */
/** The app's own logo (public/apps, from DefiLlama's icon service). */
export const AppMark = ({ id, size = 46 }: { id: string; size?: number }) => (
  <img className="app-logo" src={`/apps/${id}.webp`} alt="" width={size} height={size} />
);
