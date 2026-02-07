# latexmk configuration for slides
$pdf_mode = 4;          # 4 = lualatex
$postscript_mode = 0;
$dvi_mode = 0;

$lualatex = 'lualatex -synctex=1 -interaction=nonstopmode -halt-on-error %O %S';

$out_dir = '.';
$clean_ext = 'synctex.gz run.xml bbl bcf fdb_latexmk fls aux log out toc lof lot nav snm vrb';
