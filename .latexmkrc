# latexmk configuration — shared by Docker build and local builds
$pdf_mode = 4;          # 4 = lualatex (1=pdflatex, 2=ps2pdf, 3=dvipdf, 5=xelatex)
$postscript_mode = 0;
$dvi_mode = 0;
$silent = 1;

$lualatex = 'lualatex -synctex=1 -interaction=nonstopmode -halt-on-error %O %S';
$biber = 'biber %O %S';

# Output files
$out_dir = '.';

# Clean extensions
$clean_ext = 'synctex.gz run.xml bbl bcf fdb_latexmk fls aux log out toc lof lot blg nav snm vrb';
