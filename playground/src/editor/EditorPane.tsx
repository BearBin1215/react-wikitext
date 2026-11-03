import { indentWithTab } from "@codemirror/commands";
import { Annotation, Compartment, EditorState, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, keymap, placeholder, type DecorationSet } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

interface EditorPaneProps {
  source: string;
  onChange: (source: string) => void;
  onCursor: (offset: number) => void;
  selectedRange?: readonly [number, number];
  placeholder?: string;
}

export interface EditorPaneHandle {
  selectRange: (range: readonly [number, number]) => void;
}

const externalSelection = Annotation.define<boolean>();

const setSelectedRange = StateEffect.define<{ from: number; to: number } | null>();

const selectedRangeField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, transaction) {
    let next = decorations.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(setSelectedRange)) {
        next = effect.value
          ? Decoration.set([
              Decoration.mark({ class: "pg-editor-selected" }).range(
                effect.value.from,
                effect.value.to,
              ),
            ])
          : Decoration.none;
      }
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "13px",
    color: "var(--pg-text)",
    backgroundColor: "transparent",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "var(--pg-font-mono)",
    lineHeight: "1.6",
  },
  ".cm-content": { caretColor: "var(--pg-accent)" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--pg-accent)" },
  ".cm-gutters": {
    backgroundColor: "transparent",
    color: "var(--pg-muted)",
    border: "none",
  },
  ".cm-activeLine": { backgroundColor: "var(--pg-accent-soft)" },
  ".cm-activeLineGutter": { backgroundColor: "var(--pg-accent-soft)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "var(--pg-selection)",
  },
});

export const EditorPane = forwardRef<EditorPaneHandle, EditorPaneProps>(function EditorPane(
  { source, onChange, onCursor, selectedRange, placeholder: placeholderText },
  ref,
) {
  const container = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const lastValue = useRef(source);
  const emittedValues = useRef<string[]>([]);
  const onChangeRef = useRef(onChange);
  const onCursorRef = useRef(onCursor);
  const [placeholderSlot] = useState(() => new Compartment());
  const initialPlaceholder = useRef(placeholderText);

  useEffect(() => {
    onChangeRef.current = onChange;
    onCursorRef.current = onCursor;
  }, [onChange, onCursor]);

  useImperativeHandle(
    ref,
    () => ({
      selectRange(range) {
        const view = viewRef.current;
        if (!view) {
          return;
        }
        const length = view.state.doc.length;
        const from = Math.max(0, Math.min(range[0], length));
        const to = Math.max(from, Math.min(range[1], length));
        if (from === to) {
          return;
        }
        view.dispatch({
          selection: { anchor: from, head: to },
          effects: EditorView.scrollIntoView(from, { y: "nearest" }),
          annotations: externalSelection.of(true),
        });
      },
    }),
    [],
  );

  useEffect(() => {
    const parent = container.current;
    if (!parent) {
      return;
    }
    const state = EditorState.create({
      doc: lastValue.current,
      extensions: [
        basicSetup,
        keymap.of([indentWithTab]),
        EditorState.tabSize.of(2),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ "aria-label": "Wikitext 源码" }),
        placeholderSlot.of(
          initialPlaceholder.current ? placeholder(initialPlaceholder.current) : [],
        ),
        selectedRangeField,
        editorTheme,
        EditorView.updateListener.of((update) => {
          const selection = update.state.selection.main;
          if (container.current) {
            container.current.dataset.selection = `${selection.from},${selection.to}`;
          }
          if (update.docChanged) {
            const value = update.state.doc.toString().replace(/\r\n?/gu, "\n");
            lastValue.current = value;
            emittedValues.current.push(value);
            if (emittedValues.current.length > 20) {
              emittedValues.current.shift();
            }
            onChangeRef.current(value);
          }
          if (update.selectionSet || update.docChanged) {
            const external = update.transactions.some((transaction) =>
              transaction.annotation(externalSelection),
            );
            if (!external) {
              onCursorRef.current(update.state.selection.main.head);
            }
          }
        }),
      ],
    });
    const view = new EditorView({ state, parent });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [placeholderSlot]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: placeholderSlot.reconfigure(placeholderText ? placeholder(placeholderText) : []),
    });
  }, [placeholderText, placeholderSlot]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || source === view.state.doc.toString()) {
      return;
    }
    // React 状态可能滞后于连续输入；回放旧值会把编辑器内容截断。
    if (emittedValues.current.includes(source)) {
      return;
    }
    lastValue.current = source;
    emittedValues.current = [];
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: source },
      annotations: externalSelection.of(true),
    });
  }, [source]);

  const from = selectedRange?.[0];
  const to = selectedRange?.[1];

  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    const length = view.state.doc.length;
    if (from === undefined || to === undefined) {
      view.dispatch({ effects: setSelectedRange.of(null) });
      return;
    }
    const start = Math.max(0, Math.min(from, length));
    const end = Math.max(0, Math.min(to, length));
    if (start === end) {
      view.dispatch({ effects: setSelectedRange.of(null) });
      return;
    }
    view.dispatch({ effects: setSelectedRange.of({ from: start, to: end }) });
  }, [from, to]);

  return <div className="pg-editor" data-testid="pg-editor" ref={container} />;
});
