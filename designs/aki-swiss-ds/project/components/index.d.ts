import type * as React from 'react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost';
  href?: string;
}
export declare function Button(props: ButtonProps): React.ReactElement;

export interface TagProps {
  tone?: 'neutral' | 'accent';
  className?: string;
  children?: React.ReactNode;
}
export declare function Tag(props: TagProps): React.ReactElement;

export interface SpecRowProps {
  label: string;
  value: string;
  className?: string;
}
export declare function SpecRow(props: SpecRowProps): React.ReactElement;

declare global {
  interface Window {
    AkiSwiss: {
      Button: typeof Button;
      Tag: typeof Tag;
      SpecRow: typeof SpecRow;
    };
  }
}
