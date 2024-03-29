
/**
 * Module dependencies.
 */

var express = require('express')
  , routes = require('./routes/routes.js')

var app = module.exports = express.createServer();

// Configuration

app.configure(function(){
  app.set('views', __dirname + '/views');
  app.set('view engine', 'ejs');
  app.use(express.bodyParser());
  app.use(express.methodOverride());
  app.use(app.router);
  app.use(express.static(__dirname + '/public'));
});

app.configure('development', function(){
  app.use(express.errorHandler({ dumpExceptions: true, showStack: true })); 
});

app.configure('production', function(){
  app.use(express.errorHandler()); 
});

// Routes

app.get('/new', routes.newUrl);
// :bksid is the parameter for lineURL to the TriMet server
app.get('/transit/:title/:bksid', routes.transitmap);
app.get('/walk/:title/:from/:to', routes.walkmap);
app.get('/realtime/:stopId/:name/:line', routes.realtime);
app.get('/:id', routes.index);

app.listen(process.env.PORT || 3000);
console.log("Express server listening on port %d in %s mode", app.address().port, app.settings.env);
