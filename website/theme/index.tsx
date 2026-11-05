import type { ReactElement } from "react";
import { Layout as DefaultLayout, type LayoutProps } from "@rspress/core/theme-original";
import { HomeExample } from "./HomeExample";

function Layout(props: LayoutProps): ReactElement {
  return (
    <DefaultLayout
      {...props}
      afterFeatures={
        <>
          {props.afterFeatures}
          <HomeExample />
        </>
      }
    />
  );
}

export { Layout };
export * from "@rspress/core/theme-original";
