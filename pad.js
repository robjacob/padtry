// To run: see ./startup -

/*
 * The node.js (backend) part of the system holds the data base of bookmarks
 * is generally passive
 * Also applescript calls probably all have to be from this side
 *
 * Our URL syntax: http://localhost:10099/?action=ACTION&state=123&pad=123
 * where ACTION = brain, view, save
 * see inline documentation in code below for details of each
 *
 * NB Currently we only send our own fixed constants or else numbers via URL,
 * if send other data, might want escape(thedata)
 *
 * NB Thumbnail stuff leaves files in $TMPDIR
 */

// Node.js requires this if you use new class syntax
"use strict";

var child_process = require ('child_process')

// For choosing how many items to retrieve
// Units are square of Euclidean distance
const RADIUSNEAR = .1 // Very close, always show all items within this radius
const RADIUSFAR = .2 // Less close, never show items further than this
const NTOPCHOICES = 5

// A single brain state reading, raw features, no classifier.
class BrainPoint {
    constructor () {
	this.data = []
	for (var a of arguments) {
	    this.data.push(a)
	}
    }

    // Square of Euclidean distance to point p
    dist (p) {
	var ans = 0
	this.data.forEach (function (value, index) {
	    ans += (p.data[index] - value) * (p.data[index] - value)
	})
	return ans
    }	
}

// Latest measurements, what we would act upon
var currentBrainState = new BrainPoint (0, 0, 0, 0, 0)
var currentInterest = 0.5

class Bookmark {
    constructor (url, title, thumb, selection) {
	this.url = url;
	this.title = title;

	// Specific selection if applicable (vice just save URL)
	// text or null
	this.selection = selection

	// Filename (temporary file) of thumbnail
	this.thumb = thumb

	// Brain measurement to be associated with this bookmark
	this.brainPoint = currentBrainState;

	// Other brain (or physio) state info, for gradient bookmark retrieval
	this.interest = currentInterest;

	// We set this one ourselves
	this.time = new Date();
    }
}

var allBookmarks = []

// Separate function just for clarity, called by doRequest below
// Return list of best candidates for user to View
function chooseBookmarks () {
	var candidates = []
	allBookmarks.forEach (function (b) {
		var dist = b.brainPoint.dist(currentBrainState)
		if (dist < RADIUSFAR) {
			candidates.push ( {dist: dist, bookmark: b} )
		}
	})

	candidates.sort(function (a,b) {return a.dist - b.dist})

	// 1. Take all choices within RADIUSNEAR
	// 2. If <NTOPCHOICES, take the top NTOPCHOICES items within RADIUSFAR
	// and always order the displayed items by distance,
	// (they are already sorted in candidates[] )
	if (candidates.length < NTOPCHOICES) {
		return candidates
	}
	else if (candidates[NTOPCHOICES].dist < RADIUSNEAR) {
		var last = candidates.findIndex (function (c) { return c.dist >= RADIUSNEAR })
		if (last == -1) return candidates
		else return candidates.slice (0, last)
	}
	else {
		return candidates.slice (0, NTOPCHOICES)
	}
}

// Call from our server
function doRequest (params) {
	// Brain
	// Store current brain reading
	// Arg = 5 comma-separated raw numbers 0..100 for now
	if (params["action"]=="brain") {
		// Convert it from slider 0..100 to 0..1
		// and save it in our variable
		var coords = params["state"].split(',');

		// This hard codes the fact that we have 5 coordinates
		currentBrainState = new BrainPoint (
		    parseInt (coords[0])/100.0,
		    parseInt (coords[1])/100.0,
		    parseInt (coords[2])/100.0,
		    parseInt (coords[3])/100.0,
		    parseInt (coords[4])/100.0
		)

		// Placeholder, intend to be getting this from physio or other sensor
		currentInterest = Math.random()

    		// Nothing to return, but apparently server requires a string
		return "";
	}

	// View
	// Show bookmarks relevant to current brain state
	// No args
	// Return json struct of entire relevant subset of bookmarks
	else if (params["action"]=="view") {
		return JSON.stringify (chooseBookmarks ().map(
			function (item) {return item.bookmark}))
	}

	// Save
	// Save current page in allBookmarks, no change display
	// No args
	// Return nothing
	else if (params["action"]=="save") {
		// We get all the data for a bookmark in one shot,
		// and install the bookmark in the callback
		// to avoid further asynchronous callback ugliness
		child_process.exec ("sh getbookmark.sh", function(error, stdout, stderr) { 
			if (error!=null) console.error ("getbookmark.sh returned error: " + error);
			if (stderr!="") console.error ("getbookmark.sh returned stderror: " + stderr);

			// Parse the returned data
			var url = stdout.split("\n")[0]
			var title = stdout.split("\n")[1]
			var tempfilename = stdout.split("\n")[2]
			var selection = stdout.split("\n").slice(3).reduce (function (a,b) { return a + "\n" + b; }, "")
			if (selection.trim() == "") selection = null;

			// Save the bookmark (using current brain state)
			allBookmarks.push (new Bookmark (url, title, tempfilename, selection))
		})

    		// This will return without waiting for above child process
		return "";
	}

	else {
		console.error ("Error in ACTION passed to pad.js doRequest: " + params["action"])
		return "";
	}
}

/*
 * Call from brainclient, arg = line of text from matlab
 * This is coming from a separate thread,
 * both threads access currentBrainState and currentInterest
 * we set them, others just read them (except the GUI slider)
 * and it's a single atomic setting of a variable,
 * so synchronization issues should be ok
 */
function doBrain (line) {
	var tokens = line.trim().split (",")
	if (tokens.length < 5) {
		console.error ("doBrain: can't parse input line: " + line);
	}
	else {
		// This hard codes the fact that we have 5 coordinates
		currentBrainState = new BrainPoint (
		    parseFloat (tokens[0]),
		    parseFloat (tokens[1]),
		    parseFloat (tokens[2]),
		    parseFloat (tokens[3]),
		    parseFloat (tokens[4])
		)
	}
}

// Some miscellaneous initialization to start us up
allBookmarks.push (new Bookmark ("http://www.tufts.edu/\n", "Tufts University\n", null, null))
currentBrainState = new BrainPoint (.4, 0, 0, 0, 0)
allBookmarks.push (new Bookmark ("http://www.cs.tufts.edu/~jacob/\n", "Rob Jacob Home Page\n", null, null))
currentBrainState = new BrainPoint (.8, 0, 0, 0, 0)
allBookmarks.push (new Bookmark ("http://www.tufts.edu/home/visiting_directions/\n", "Visiting, Maps & Directions - Tufts University\n", null, null))
currentBrainState = new BrainPoint (0, 0, 0, 0, 0)

exports.doRequest = doRequest;
exports.doBrain = doBrain;

/*
 * Various testing
 */

if (require.main === module) {
	var b = new Bookmark ("http://www.tufts.edu/home/visiting_directions/\n", "Visiting, Maps & Directions - Tufts University\n", null, null);
	console.log (b)
	console.log (JSON.stringify(b))

	console.log (" ")
	var b3 = JSON.parse (JSON.stringify(b))
	console.log (b3)
	console.log (JSON.stringify(b) == JSON.stringify(b3))

	console.log (" ")
	console.log (currentBrainState)

	doRequest ({action: "brain", state: "11,22,33,44,55" })
	console.log (currentBrainState, currentInterest)

	doRequest ({action: "brain", state: "40,22,33,44,55" })
	console.log (currentBrainState, currentInterest)

	doRequest ({action: "brain", state: "60,22,33,44,55" })
	console.log (currentBrainState, currentInterest)

	doRequest ({action: "brain", state: "80,22,33,44,55" })
	console.log (currentBrainState, currentInterest)

	doRequest ({action: "view" })

	console.log (allBookmarks.length)
	doRequest ({action: "save" })
	// console.log (allBookmarks.length, allBookmarks)

	// Temporary testing
	allBookmarks.push (new Bookmark ("http://www.cs.tufts.edu/~jacob/papers\n", "Rob Jacob Papers\n", null, null))
	allBookmarks.push (new Bookmark ("http://www.cs.tufts.edu/~jacob/papers\n", "Rob Jacob Papers\n", null, null))
	currentBrainState = new BrainPoint (.11, .22, .33, .44, .551)
	allBookmarks.push (new Bookmark ("http://www.cs.tufts.edu/~jacob/papers\n", "Rob Jacob Papers\n", null, null))
	allBookmarks.push (new Bookmark ("http://www.cs.tufts.edu/~jacob/papers\n", "Rob Jacob Papers\n", null, null))
	currentBrainState = new BrainPoint (.11, .22, .33, .44, .555)
	allBookmarks.push (new Bookmark ("http://www.cs.tufts.edu/~jacob/papers\n", "Rob Jacob Papers\n", null, null))
	allBookmarks.push (new Bookmark ("http://www.cs.tufts.edu/~jacob/papers\n", "Rob Jacob Papers\n", null, null))
	allBookmarks.push (new Bookmark ("http://www.cs.tufts.edu/~jacob/papers\n", "Rob Jacob Papers\n", null, null))
	allBookmarks.push (new Bookmark ("http://www.cs.tufts.edu/~jacob/papers\n", "Rob Jacob Papers\n", null, null))
	currentBrainState = new BrainPoint (.11, .22, .33, .44, 123)
	allBookmarks.push (new Bookmark ("http://www.cs.tufts.edu/~jacob/papers\n", "Rob Jacob Papers\n", null, null))
	allBookmarks.push (new Bookmark ("http://www.cs.tufts.edu/~jacob/papers\n", "Rob Jacob Papers\n", null, null))
	currentBrainState = new BrainPoint (.11, .22, .33, .44, .55)

	currentBrainState = new BrainPoint (0, 0, 0, 0, 0)
    	doRequest ({action: "save" })
    	doRequest ({action: "save" })
    	doRequest ({action: "save" })
    	doRequest ({action: "save" })
    	doRequest ({action: "view" })

	var c = chooseBookmarks()
	console.log (c.length, allBookmarks.length)
	console.log (JSON.stringify(c.map(
		function(item) {
	            return item.bookmark})))
	// console.log (allBookmarks)
}
