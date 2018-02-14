rem requires inkscape.org and ghostscript.org, both in the path variable
cd ..\renders
for %i in (*.svg) do inkscape -P=%~ni.ps -d300 -z %i
dir /b /o:n *.ps > psfiles.lst
gswin64c.exe -r300x300 -o cards.pdf -sDEVICE=pdfwrite @psfiles.lst
