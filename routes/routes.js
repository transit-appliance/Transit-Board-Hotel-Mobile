/**
 * routes.js: All the routes for node-mobile
 * I don't like having a bunch of 10 line files spread across the fs.
 */

/* // Commented out because, for now, we're using an in-memory store
// for fetches
// set up DB stuff. This should really be moved to another module
var cradle = require('cradle');
cradle.setup({
host: 'transit-appliance.couchone.com',
cache: true, // fine to cache since we're the only ones who will be
// accessing this
raw: false
});

// TODO: should connection be here or in each use of it?
var conn = new cradle.Connection();
*/

var querystring = require('querystring');
var request = require('request');
var $ = require('jquery'); // wouldn't parse XML without it.
var Proj4js = require('proj4js');
var time = require('time');
// not included in node p4js
Proj4js.defs["EPSG:2913"] = '+proj=lcc +lat_1=46 +lat_2=44.33333333333334 +lat_0=43.66666666666666 +lon_0=-120.5 +x_0=2500000.0001424 +y_0=0 +ellps=GRS80 +to_meter=0.3048 +no_defs';

// length of the codes for trips
var CODE_LENGTH = 5;
var itineraries = {};

/**
 * clean out the URLs
 */
setInterval(function () {
   var now = new Date().getTime();
   for (var i in itineraries) {
      if (now > itineraries[i].lifetime) {
         console.log('clearing ' + i);
         itineraries[i] = undefined;
      }
   }
}, 30 * 60 * 1000);

/**
 * Parse out the time from the TriMet JSON WS.
 */
function parseISOTime (isotime) {
    var year = isotime.slice(0, 4);
    var mo = Number(isotime.slice(5,7)) - 1; // Jan is 0 in JS
    var day = isotime.slice(8, 10)
    var hour = isotime.slice(11, 13);
    var min = isotime.slice(14, 16);
    // Must be number or will be interpreted as tz
    var sec = Number(isotime.slice(17,18));
    // Should get TriMet's TZ from GTFS agency defn, in case Oregon makes its own time
    // (e.g. America/Portland)
    return new time.Date(year, mo, day, hour, min, sec, 'America/Los_Angeles');
}

/**
 * get a time like 8:41 pm
 * @param {Date} the date/time
 * @returns {String} a human time
*/
function makeHumanTime(theDate) {
   var hour = theDate.getHours() % 12;
   var mins = theDate.getMinutes();
   
   if (mins < 10) mins = '0' + mins;

   if (hour == 0) hour = 12;
   if (theDate.getHours() >= 12) var ap = 'pm';
   else                          var ap = 'am';

   return hour + ':' + mins + ' ' + ap;
}

/**
 * get a trip plan from the TriMet WS
 * @param {object} itin the itinerary
 * @param {function} cb the callback
 */
function getTripPlan(itin, cb) {
   var now = new time.Date();
   now.setTimezone('America/Los_Angeles');

    var rtime = makeHumanTime(now);

   // build the URL
   params = {
      fromCoord: itin.fromCoord,
      fromPlace: itin.fromPlace,
      toCoord:   itin.toCoord,
      toPlace:   itin.toPlace,
      time:      rtime,
      Min:       'X', // fewest transfers
      appID:     '828B87D6ABC0A9DF142696F76'
   };

   // http://stackoverflow.com/questions/6554039/how-do-i-url-encode-something-in-node-js
   var qs = querystring.stringify(params);
   var wsurl = 'http://developer.trimet.org/ws/V1/trips/tripplanner?' + qs;

   request(wsurl, function (err, res, body) {
      if (!err && res.statusCode == 200) {
         // choose the best itinerary
         // should probably try to share code with tbdhotel.js, but this is a 
         // bit different because we never throw itineraries out but only cost against them.
         // a long itinerary is better than none at all.
         var lowcost = Infinity;
         var bestItin = null;
         $(body).find('itinerary').each(function (ind, itin) {
	        var itin = $(itin);
	        
	        // TODO: handle throughroutes when formulating narrative
	        // in the mobile app, 

	        // route 90 is an alternate number for MAX
	        // 90: MAX Red Line
	        // 100: MAX Blue Line
	        // 190: MAX Yellow Line
	        // 193: Streetcar
	        // 200: MAX Green Line
	        var freqService = ['4', '6', '8', '9', '12', '14',
			                   '15', '33', '54', '56', '57',
			                   '72', '75', '90', '100', '190', '193',
			                   '200'];
	        var isFreqService = true;
	        itin.find('leg route internalNumber').each(function () {
	           if ($.inArray($(this).text(), freqService) == -1) {
	              isFreqService = false;
	           }
	        });

	        var cost = Number(itin.find('time-distance duration').first().text()) +
	           0.1 * Number(itin.find('fare regular').first().text());

	        // penalize equivalent of 30 mins for non-frequent-service route
	        if (!isFreqService) cost += 30;

	        if (cost < lowcost) {
	           bestItin = itin;
	           lowcost = cost;
	        }
         });
         cb(bestItin);
      }
      else {
         cb(null);
      }
   });
}


/** 
 * Index: grab the requested trip from the 3 character identifier
 */
exports.index = function(req, res){
   // they are *always* lower case
   var itinID = req.params.id.toLowerCase();

   // fetch the itinerary
   var itin = itineraries[itinID];
   if (itin == undefined) {
      res.render('notfound', { status: 404, id: itinID, title: 'Not Found' });
   }
   else {
      // reverse if needed
      if (req.param('reverse', false) == 'true') var reverse = true;
      else var reverse = false;

      if (reverse) {
         var itin = {
	        fromPlace: itin.toPlace,
	        fromCoord: itin.toCoord,
	        toPlace  : itin.fromPlace,
	        toCoord  : itin.fromCoord
         }
      }
      
      // make a TriMet URL

      // get a trip plan
      getTripPlan(itin, function (tp) {
         if (tp == null) legs = false; // indicate to the view that no trip was found
         // really cheesy, but all I could figure out so that view gets a jQ obj not a DOM one
         else {
	        legs = [];
	        tp.find('leg').each(function (ind, leg) {
	           legs.push($(leg));
	        });
         }

         res.render('index', {title: itin.fromPlace + ' to ' + itin.toPlace, legs: legs, 
			                  fromPlace: itin.fromPlace, toPlace: itin.toPlace,
			                  reverse: reverse, stopId: tp.find('leg from stopId').first().text()});
      });
   }
};


/**
 * Validate a data structure for saving.
 * @param {object} data
 * @returns {bool} is it valid, or not?
 */
function isValid (data) {
   // TODO: do something in here
   return true;
}

/**
 * newUrl: make a new short url
 */
exports.newUrl = function (req, res) {
   // TODO: validation
   
   // some deliberately left out to avoid confusion
   var letters = 'abcdefghjkmnpqrstuvwxyz23456789';
   var numbers = '23456789';

   // get a new three letter code
   while (true) {
      var code = '';

      // 
      for (var i = 0; i < CODE_LENGTH; i++) {
         // make the middle one a number so that untoward words will
         // not be spelled out.
         if (i == 1) {
	        code += numbers[Math.round(Math.random() * (numbers.length - 1))];
         }
         else {
	        code += letters[Math.round(Math.random() * (letters.length - 1))];
         }
      }

      if (itineraries[code] == undefined) {
         break;
      }
   }

   // create and validate the data structure
   var data = {};
   // http://stackoverflow.com/questions/6912584/how-to-get-get-query-string-variables-in-node-js
   data.fromCoord = req.query.fromCoord;
   data.fromPlace = req.query.fromPlace;
   data.toCoord   = req.query.toCoord;
   data.toPlace   = req.query.toPlace;
   // delete after 24 hours
   data.lifetime  = new Date().getTime() + 24 * 60 * 60 * 1000;

   res.header("Access-Control-Allow-Origin", "*");
   res.header("Access-Control-Allow-Headers", "X-Requested-With");

   if (isValid(data)) {
      itineraries[code] = data;
      res.end(code + '\n');
   }
   else {
      res.statusCode = 400; // bad request
      res.end('bad data\n');
   }
};

/**
 * Render a walking map using CloudMade Static Maps.
 */
exports.walkmap = function (req, res) {
   var url = 'http://routes.cloudmade.com/2d634343963a4426b126ab70b62bba2a/api/0.3/' + req.param('from') + ',' + req.param('to') + 
      '/foot.js?lang=en&units=km';

   request(url, function (err, resp, body) {
      // build the_geom
      var the_geom = [];
      var wasRequestSuccessful = false;
      
      var bbox = {
         left: Infinity,
         right: -Infinity,
         top: -Infinity,
         bot: Infinity
      };

      if (!err && resp.statusCode == 200) {
         var data = JSON.parse(body);
         if (data.status == 0) {
            wasRequestSuccessful = true;
	        $.each(data.route_geometry, function (ind, pt) {
	           if (pt[1] < bbox.left) bbox.left = pt[1];
	           if (pt[1] > bbox.right) bbox.right = pt[1];
	           if (pt[0] > bbox.top) bbox.top = pt[0];
	           if (pt[0] < bbox.bot) bbox.bot = pt[0];
	           the_geom.push(pt.join(','));
	        });
         }
      }

      if (!wasRequestSuccessful) {
         // CloudMade failure, happens sometimes
         the_geom = [req.param('from'), req.param('to')];
         var from = req.param('from').split(',');
         var to = req.param('to').split(',');
         bbox.left = Math.min(from[1], to[1]);
         bbox.right = Math.max(from[1], to[1]);
         bbox.top = Math.max(from[0], to[0]);
         bbox.bot = Math.min(from[0], to[0]);
      }

      var cmparams = {
         size: '320x320',
         bbox: [bbox.bot, bbox.left, bbox.top, bbox.right].join(','),
         path: 'color:0x3333dd|weight:7|opacity:1.0|' + the_geom.join('|')
      };
      
      var imgurl = 'http://staticmaps.cloudmade.com/2d634343963a4426b126ab70b62bba2a/staticmap?' + querystring.stringify(cmparams);

      res.render('map', {title: req.param('title'), imgurl: imgurl, referrer: req.headers['referer']});  
   });
};

/**
 * Render a transit map using CloudMade Static Maps. At some point we will use Leaflet to also allow panning the maps.
 */
exports.transitmap = function (req, res) {
   // fetch the TriMet WS and reproject
   var params = {
      appID: '828B87D6ABC0A9DF142696F76',
      // I think this stands for block, start time, start stop ID, 
      // end time, end ID.
      bksTsIDeTeID: req.param('bksid')
   }
   var url = 'http://maps.trimet.org/ttws/transweb/ws/V1/BlockGeoWS?' + querystring.stringify(params);

   request(url, function (err, resp, body) {
      if (!err && resp.statusCode == 200) {
         // no trickery to do this in Node!
         var data = JSON.parse(body);
         
         // reproject OSPN -> 4326 Lat Lon
         var the_geom = [];

         // Oregon State Plane North, NAD83(HARN)
         var from_proj = new Proj4js.Proj('EPSG:2913');
         var to_proj = new Proj4js.Proj('EPSG:4326');

         var bbox = {
	        left: Infinity,
	        right: -Infinity,
	        top: -Infinity,
	        bot: Infinity
         };

         // should only be one result for a single leg
         $.each(data.results[0].points, function (ind, pt) {
	        var point = new Proj4js.Point(pt.x, pt.y);
	        Proj4js.transform(from_proj, to_proj, point);
	        the_geom.push(point.y + ',' + point.x);

	        if (point.x < bbox.left) bbox.left = point.x;
	        if (point.x > bbox.right) bbox.right = point.x;
	        if (point.y > bbox.top) bbox.top = point.y;
	        if (point.y < bbox.bot) bbox.bot = point.y;
         });

         var path = the_geom.join('|');

         var cmparams = {
	        size: '320x320',
	        bbox: [bbox.bot, bbox.left, bbox.top, bbox.right].join(','),
	        path: 'color:0x3333dd|weight:7|opacity:1.0|' + path
         };

         var imgurl = 'http://staticmaps.cloudmade.com/2d634343963a4426b126ab70b62bba2a/staticmap?' + querystring.stringify(cmparams);      

         // referer [sic]
         res.render('map', {title: req.param('title'), imgurl: imgurl, referrer: req.headers['referer']});
      }
   });
};

/**
 * Get real-time arrivals.
 */
exports.realtime = function (req, res) {
    var params = {
        appID: '828B87D6ABC0A9DF142696F76',
        locIDs: req.param('stopId'),
        json: true
    };

    var url = 'http://developer.trimet.org/ws/V1/arrivals?' +
        querystring.stringify(params);
    
    request(url, function (err, resp, body) {
        if (!err && resp.statusCode == 200) {

            var results = JSON.parse(body);
            var arrivals = [];
            $.each(results.resultSet.arrival, function (ind, arr) {
                // get rid of spaces, there have been whitespace
                // issues before
                if (arr.fullSign.replace(/ /g, '') == req.param('line').replace(/ /g, '')) {
                    var arrTime = parseISOTime(arr.estimated);
                    arrivals.push(makeHumanTime(arrTime));
                }
            });

            var active = parseISOTime(results.resultSet.queryTime);
            var activeh = makeHumanTime(active);
            
            // refresh it here, every minute
            res.header('Refresh', '60');

            res.render('realtime', {valid: activeh, arrivals: arrivals.join(', '), tripName: req.param('line'), stopId: req.param('stopId'), title: 'Real-Time Arrivals',
                                    // sic
                                    referrer: req.headers['referer']});
        }
        else {
          res.end('');
        }
    });    
};
