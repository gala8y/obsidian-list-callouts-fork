import { ensureSyntaxTree, tokenClassNodeProp } from '@codemirror/language';
import {
  EditorState,
  RangeSetBuilder,
  StateEffect,
  StateField,
} from '@codemirror/state';
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from '@codemirror/view';
import { setIcon, editorLivePreviewField } from 'obsidian';

import { CalloutConfig } from './settings';

export const setConfig = StateEffect.define<CalloutConfig>();

export class CalloutBackground extends WidgetType {
  toDOM() {
    return createSpan({
      cls: 'lc-list-bg',
      attr: {
        'aria-hidden': 'true',
      },
    });
  }
  eq(): boolean {
    return true;
  }
}

export class CalloutMarker extends WidgetType {
  char: string;
  icon?: string;
  color?: string;

  constructor(char: string, icon?: string, color?: string) {
    super();

    this.char = char;
    this.icon = icon;
    this.color = color;
  }

  toDOM() {
    return createSpan(
      {
        text: this.char,
        cls: 'lc-list-marker',
        attr: {
          'aria-hidden': 'true',
          style: this.color ? `color: rgb(${this.color}); margin-right: 4px;` : '',
        },
      },
      (s) => {
        if (this.icon) {
          setIcon(s, this.icon);
        }
      }
    );
  }

  eq(widget: CalloutMarker): boolean {
    return widget.char === this.char && widget.icon === this.icon && widget.color === this.color;
  }
}


export const calloutDecoration = (char: string, color: string) =>
  Decoration.line({
    attributes: {
      class: 'lc-list-callout',
      style: `--lc-callout-color: ${color}`,
      'data-callout': char,
    },
  });

export const calloutsConfigField = StateField.define<CalloutConfig>({
  create() {
    return { callouts: {}, re: null };
  },
  update(state, tr) {
    for (const e of tr.effects) {
      if (e.is(setConfig)) {
        state = e.value;
      }
    }

    return state;
  },
});

export function buildCalloutDecos(view: EditorView, state: EditorState) {
  const config = state.field(calloutsConfigField);
  if (!config?.re || !view.visibleRanges.length) return Decoration.none;

  // Detect if the editor is currently in Live Preview mode
  const isLivePreview = state.field(editorLivePreviewField);

  const builder = new RangeSetBuilder<Decoration>();
  const lastRange = view.visibleRanges[view.visibleRanges.length - 1];
  const tree = ensureSyntaxTree(state, lastRange.to, 50);
  const { doc } = state;

  let lastEnd = -1;

  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter({ type, from, to }): false | void {
        if (from <= lastEnd) return;

        const prop = type.prop(tokenClassNodeProp);
        if (prop && /formatting-list/.test(prop)) {
          const { from: lineFrom, to: lineTo, text } = doc.lineAt(from);
          const match = text.match(config.re);

          if (match) {
            lastEnd = lineTo;
            
            const matchedCharsText = match[2];
            const matchedChars = matchedCharsText.split(' ').filter(c => c.length > 0);
            const callouts = matchedChars.map(c => config.callouts[c]).filter(Boolean);

            if (callouts.length > 0) {
              const mainCallout = callouts[0];

              builder.add(lineFrom, lineFrom, calloutDecoration(mainCallout.char, mainCallout.color));

              builder.add(
                lineFrom,
                lineFrom,
                Decoration.widget({ widget: new CalloutBackground(), side: -1 })
              );

              let currentPos = lineFrom + match[1].length;
              for (const char of matchedChars) {
                const callout = config.callouts[char];
                if (callout) {
                  if (isLivePreview) {
                    // In Live Preview: Replace the text with the Icon Widget
                    builder.add(
                      currentPos,
                      currentPos + char.length,
                      Decoration.replace({
                        widget: new CalloutMarker(callout.char, callout.icon, callout.color),
                      })
                    );
                  } else {
                    // In Source View: Keep the text, but colorize it so it stands out
                    builder.add(
                      currentPos,
                      currentPos + char.length,
                      Decoration.mark({
                        attributes: { style: `color: rgb(${callout.color}); font-weight: bold;` }
                      })
                    );
                  }
                }
                currentPos += char.length + 1;
              }
            }
          }
        }
      },
    });
  }

  return builder.finish();
}

export const calloutExtension = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildCalloutDecos(view, view.state);
    }

    update(update: ViewUpdate) {
      // Check if the user toggled between Live Preview and Source mode
      const livePreviewChanged = 
        update.startState.field(editorLivePreviewField) !== 
        update.state.field(editorLivePreviewField);

      if (
        update.docChanged ||
        update.viewportChanged ||
        livePreviewChanged || // Force redraw when the view mode changes
        update.transactions.some((tr) =>
          tr.effects.some((e) => e.is(setConfig))
        )
      ) {
        this.decorations = buildCalloutDecos(update.view, update.state);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  }
);

