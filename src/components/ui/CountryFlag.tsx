import React from 'react';

interface CountryFlagProps {
  isoCode?: string;
  className?: string;
}

export const CountryFlag: React.FC<CountryFlagProps> = ({ isoCode, className = '' }) => {
  switch (isoCode) {
    case 'TR':
      return (
        <svg
          viewBox="0 0 24 16"
          aria-hidden="true"
          className={`w-[18px] h-[12px] rounded-[2px] shrink-0 ${className}`}
        >
          <rect width="24" height="16" fill="#E30A17" />
          <circle cx="9.6" cy="8" r="4.2" fill="#FFFFFF" />
          <circle cx="10.7" cy="8" r="3.4" fill="#E30A17" />
          <polygon
            points="15.2,8 13.7,8.5 14.3,9.9 13.1,9 11.9,9.9 12.4,8.5 11.2,7.6 12.7,7.6 13.1,6.2 13.6,7.6"
            fill="#FFFFFF"
          />
        </svg>
      );
    case 'CL':
      return (
        <svg
          viewBox="0 0 24 16"
          aria-hidden="true"
          className={`w-[18px] h-[12px] rounded-[2px] shrink-0 ${className}`}
        >
          <rect width="24" height="8" fill="#FFFFFF" />
          <rect y="8" width="24" height="8" fill="#D52B1E" />
          <rect width="8" height="8" fill="#0039A6" />
          <polygon
            points="4,2 4.6,3.7 6.4,3.7 5,4.7 5.5,6.4 4,5.4 2.5,6.4 3,4.7 1.6,3.7 3.4,3.7"
            fill="#FFFFFF"
          />
        </svg>
      );
    case 'IS':
      return (
        <svg
          viewBox="0 0 24 16"
          aria-hidden="true"
          className={`w-[18px] h-[12px] rounded-[2px] shrink-0 ${className}`}
        >
          <rect width="24" height="16" fill="#02529C" />
          <rect x="6" width="4" height="16" fill="#FFFFFF" />
          <rect y="6" width="24" height="4" fill="#FFFFFF" />
          <rect x="7" width="2" height="16" fill="#DC1E35" />
          <rect y="7" width="24" height="2" fill="#DC1E35" />
        </svg>
      );
    case 'CA':
      return (
        <svg
          viewBox="0 0 24 16"
          aria-hidden="true"
          className={`w-[18px] h-[12px] rounded-[2px] shrink-0 ${className}`}
        >
          <rect width="24" height="16" fill="#FFFFFF" />
          <rect width="6" height="16" fill="#D80621" />
          <rect x="18" width="6" height="16" fill="#D80621" />
          <polygon
            points="12,3 13,6 15,5.5 14,7.5 15.5,8.5 13,9.5 13.5,11 12.3,10.5 12.3,13 11.7,13 11.7,10.5 10.5,11 11,9.5 8.5,8.5 10,7.5 9,5.5 11,6"
            fill="#D80621"
          />
        </svg>
      );
    case 'US':
      return (
        <svg
          viewBox="0 0 24 16"
          aria-hidden="true"
          className={`w-[18px] h-[12px] rounded-[2px] shrink-0 ${className}`}
        >
          <rect width="24" height="16" fill="#FFFFFF" />
          <rect y="0" width="24" height="2.3" fill="#B22234" />
          <rect y="4.6" width="24" height="2.3" fill="#B22234" />
          <rect y="9.2" width="24" height="2.3" fill="#B22234" />
          <rect y="13.7" width="24" height="2.3" fill="#B22234" />
          <rect width="10.5" height="9.2" fill="#3C3B6E" />
        </svg>
      );
    case 'ES':
      return (
        <svg
          viewBox="0 0 24 16"
          aria-hidden="true"
          className={`w-[18px] h-[12px] rounded-[2px] shrink-0 ${className}`}
        >
          <rect width="24" height="16" fill="#AA151B" />
          <rect y="4" width="24" height="8" fill="#F1BF00" />
        </svg>
      );
    case 'ET':
      return (
        <svg
          viewBox="0 0 24 16"
          aria-hidden="true"
          className={`w-[18px] h-[12px] rounded-[2px] shrink-0 ${className}`}
        >
          <rect width="24" height="5.33" fill="#078930" />
          <rect y="5.33" width="24" height="5.34" fill="#FCDD09" />
          <rect y="10.67" width="24" height="5.33" fill="#DA121A" />
          <circle cx="12" cy="8" r="2.6" fill="#0F47AF" />
        </svg>
      );
    case 'NO':
      return (
        <svg
          viewBox="0 0 24 16"
          aria-hidden="true"
          className={`w-[18px] h-[12px] rounded-[2px] shrink-0 ${className}`}
        >
          <rect width="24" height="16" fill="#BA0C2F" />
          <rect x="6" width="4" height="16" fill="#FFFFFF" />
          <rect y="6" width="24" height="4" fill="#FFFFFF" />
          <rect x="7" width="2" height="16" fill="#00205B" />
          <rect y="7" width="24" height="2" fill="#00205B" />
        </svg>
      );
    default:
      return (
        <svg
          viewBox="0 0 24 16"
          aria-hidden="true"
          className={`w-[18px] h-[12px] rounded-[2px] shrink-0 ${className}`}
        >
          <rect width="24" height="16" fill="#1F242D" stroke="#4B5563" strokeWidth="1" />
          <circle cx="12" cy="8" r="4.5" fill="none" stroke="#8FA886" strokeWidth="1.2" />
          <line x1="7.5" y1="8" x2="16.5" y2="8" stroke="#8FA886" strokeWidth="1" />
        </svg>
      );
  }
};
