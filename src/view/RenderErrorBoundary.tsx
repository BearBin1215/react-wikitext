import { Component, type ReactNode } from "react";
import type { WikitextNode } from "../ast/model";

interface RenderErrorBoundaryProps {
  readonly node: WikitextNode;
  readonly source: string;
  readonly label: string;
  readonly resetKey?: unknown;
  readonly onRenderError?: (error: Error, info: { node: WikitextNode }) => void;
  readonly children: ReactNode;
}

interface RenderErrorBoundaryState {
  error?: Error;
  resetKey?: unknown;
}

function describe(node: WikitextNode): string {
  return node.type === "unknown" ? node.parserType : node.type;
}

/**
 * 单个块的错误边界；捕获渲染异常后改为显示占位说明与源码。
 * 内部组件，由 `<WikitextView>` 使用。
 */
export class RenderErrorBoundary extends Component<
  RenderErrorBoundaryProps,
  RenderErrorBoundaryState
> {
  override state: RenderErrorBoundaryState = { resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<RenderErrorBoundaryState> {
    return { error };
  }

  static getDerivedStateFromProps(
    props: RenderErrorBoundaryProps,
    state: RenderErrorBoundaryState,
  ): Partial<RenderErrorBoundaryState> | null {
    if (state.resetKey !== props.resetKey) {
      return { error: undefined, resetKey: props.resetKey };
    }
    return null;
  }

  override componentDidCatch(error: Error): void {
    this.props.onRenderError?.(error, { node: this.props.node });
  }

  override render(): ReactNode {
    if (this.state.error) {
      return (
        <section
          className="wtr-render-error"
          data-node-type={describe(this.props.node)}
          role="alert"
        >
          <span className="wtr-render-error__label">
            {this.props.label}: {describe(this.props.node)}
          </span>
          <pre className="wtr-render-error__source">{this.props.source}</pre>
        </section>
      );
    }
    return this.props.children;
  }
}
