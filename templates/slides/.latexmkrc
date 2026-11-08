# latexmk configuration: LuaLaTeX + biber, output slides.pdf.
# Run `latexmk` (build once) or `latexmk -pvc` (rebuild on every save).
@default_files = ('main.tex');
$pdf_mode = 4;            # 4 = lualatex
$postscript_mode = 0;
$dvi_mode = 0;
$jobname = 'slides';
$lualatex = 'lualatex -synctex=1 -interaction=nonstopmode -file-line-error %O %S';
$biber = 'biber --validate-datamodel %O %S';
$bibtex_use = 2;          # run biber when needed; clean .bbl with -C
$clean_ext = '%R-luamml-mathml.html synctex.gz run.xml bbl bcf fdb_latexmk fls aux log out toc lof lot lol blg nav snm vrb';
