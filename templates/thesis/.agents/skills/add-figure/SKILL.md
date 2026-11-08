---
name: add-figure
description: Add a reproducible figure to the document, either a data-driven pgfplots plot from figures/data or an image file, with meaningful alt text, sensible float placement, a caption, a label and a \cref reference. Use when the author asks for a plot, chart, diagram or image, or when check reports a figure without alt text.
---

# Add a figure

## Before you start

- The data or image must come from the author: a file in `figures/data/`,
  `figures/`, or numbers in `notes/`. Never invent or "illustrate" data.
- Look at an existing figure in the template and copy its pattern, including
  how it sets alt text.

## Plot from data (preferred)

1. Put the data in `figures/data/<name>.csv` (or confirm it is there). Keep the
   author's numbers exactly.
2. Write the plot with pgfplots reading that file:

   ```latex
   \begin{figure}[tbp]
     \centering
     % alt text: follow the pattern used by the template's existing plot
     \begin{tikzpicture}
       \begin{axis}[xlabel={Epoch}, ylabel={Validation loss}, width=\linewidth]
         \addplot table[x=epoch, y=loss, col sep=comma] {figures/data/loss.csv};
       \end{axis}
     \end{tikzpicture}
     \caption{Validation loss per epoch.}
     \label{fig:loss}
   \end{figure}
   ```

3. Label the axes with units. Use a legend only for more than one series.

If the plot is made by a script (Python, R), keep the script next to the data,
write the output to `figures/`, and include it as an image (below). Tell the
author the command that regenerates it.

## Image file

```latex
\begin{figure}[tbp]
  \centering
  \includegraphics[width=\linewidth, alt={Bar chart: method A reaches 81\% accuracy, method B 74\%, baseline 60\%.}]{figures/accuracy.pdf}
  \caption{Accuracy on the test set.}
  \label{fig:accuracy}
\end{figure}
```

Prefer PDF or PNG. Avoid `.eps` (it breaks pdfLaTeX builds on arXiv).

## Alt text

Say what the reader should learn from the figure, in one to three sentences.

- Good: "Line chart: loss falls from 2.1 to 0.4 over 50 epochs and flattens
  after epoch 30."
- Bad: "Figure 3", "A chart", "loss.pdf", or a copy of the caption.

Only state values that are in the data. A purely decorative image gets empty
alt text only if the author agrees it adds nothing.

## Placement and references

- Use `[tbp]`. Do not force `[H]` or `[h!]` everywhere.
- Place the figure environment right after the paragraph that first mentions it.
- Refer to it with `\cref{fig:loss}` in the text. Every figure must be
  referenced at least once.

## Verify

```sh
overfull build
overfull check --json --checks build,output,accessibility
overfull pages <page>      # look at it, if you can read images
```

## Done

- The figure builds, has a caption, a `fig:` label, a `\cref`, and alt text.
- The accessibility check reports no `figure-missing-alt`.
- The data or script that produces it is committed.
