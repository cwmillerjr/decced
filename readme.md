## DeCCed Card Builder
**DeCCed** (pronouned decked) was created as part of the Christmas Chaos project.  I knew I did not want to have to manage updating hundreds of cards in layout editors, etc, as I made revisions and that I had no easy way to merge data files in the programs I had available.  I had used SVG in my professional work and had a pretty good understanding of how to navigate its XML files.  I figured since SVG is just XML, I should be able to just modify the XML directly, which is just what I did.  **DeCCed** is just the De"Christmas Chaos"ed version of this utility.

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