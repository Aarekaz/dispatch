import type { JSX, SVGProps } from "react";

import { DispatchMark } from "@/components/brand/dispatch-mark";

export function AuthLogo(
  props: JSX.IntrinsicAttributes & SVGProps<SVGSVGElement>,
) {
  return <DispatchMark {...props} />;
}
