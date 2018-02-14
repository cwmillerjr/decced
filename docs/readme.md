## DeCCed Card Builder
**DeCCed** /dɛkt/ was created as part of the Christmas Chaos project.  I knew I did not want to have to manage updating hundreds of cards in layout editors, etc, as I made revisions and that I had no easy way to merge data files in the programs I had available.  I had used SVG in my professional work and had a pretty good understanding of how to navigate its XML files.  I figured since SVG is just XML, I should be able to just modify the XML directly, which is just what I did.  **DeCCed** is just the De"Christmas Chaos"ed version of this utility.

### Basic Architecture
**DeCCed** is configuration and "card driver" powered. 
* To create a card, first you'll need a card template.  You can copy a template or create your own.  In the template, you'll need just one card defined, and on that card, you'll need to tag the items that you want to update at runtime.
I've developed a method for creating the SVG templates that worked for me, but it is not necessary.
* To tell **DeCCed** what the cards it should create should contain, you'll create a "Manifest" file.  This is simply an Excel file (or tab delimited text if you prefer) with a column for each bit of information you need on the card.  For example, a name or point value.  One row for each card.
* Next you'll need to either create a "card driver".  Essentially this is just two methods you create.
    * One to map values for each row in the "Manifest" file to a POJO "Manifest" entry.
    * One to map the "Manifest" entry values to the various tagged locations in the template.

Or create an options.json file in the card directory and DeCCed will infer the column names from the Excel file by the first row starting with an "$".

**DeCCed** takes care of the rest and will create a necessary number of SVG files to create all the cards you defined.  You can also define more that one card type to be created at once.  With a few other ***free*** programs installed, you can even create a single PDF file with all of your cards, including the backs of the cards, which can be printed double sided for quick prototyping.
These programs are [Inkscape](https://inkscape.org) and [Ghost Script](https://www.ghostscript.com).  As long as you install them in the default locations, **DeCCed** will be able to find them.

### Examples
Looking in the Cards directory you'll find two examples.  The first is the convention based example named ***DefaultExample*** where the first line of the file starts with a "$" and therefore needs no programming at all.  You can see in the options.json some default values have been set up for the remaining cards on the sheet there aren't records for.

The second example ***CustomExample*** shows a more advanced card where there are pips on the card that need to be shown or hidden based on the manifest file.

### Installing
#### DeCCed project
You'll first need to download the project from [https://github.com/cwmillerjr/decced](https://github.com/cwmillerjr/decced).  If you are not proficient with git or do not want to use it, you can simply download the project in a zip file like so:
![Download](https://cwmillerjr.github.io/decced/download.png)

#### Node.js
DeCCed is a Node.js application, so you'll need an install of Node.js to use it.  This is pretty simple.  You just run the installer that is provided on the homepage of [Node.js](https://nodejs.org/).  I usually use the LTS version because reasons.

Once you've installed that, you can now create SVG files with DeCCed, but those are difficult to work with and hard to print 1:1 scale, so I also added support to convert all of it into a PDF I could print on both sides, which required two other programs.

#### Inkscape
Inkscape is a free program I used to create the card templates.  It also is used to convert the SVG output files into Post Script files as an intermediate step in converting it to PDF.  You can find Inkscape at [Inkscape.com](https://inkscape.org/).  As long as you install it in the standard location, DeCCed will be able to find it.

#### Ghost Script
The final program needed was Ghost Script.  This program can do many amazing things, of which I used it to smash the PS files created in the last step into a single PDF file for printing, etc.  You can find it at [ghostscript.com](https://www.ghostscript.com/download/gsdnld.html) and again, as long as you install it in the default location, DeCCed will find it.
