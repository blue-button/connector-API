var config   = require('nconf');
var configFile = process.env.CONFIG_FILE || './config.json';
config.argv().env().file({ file:  configFile}).defaults({PORT: 5000});

var express     = require('express'),
    xray        = require('x-ray'),
    rekwest     = require('request'),
    iodocs      = require('./apidocs'),
    querystring = require('querystring'),
    cors        = require('cors'),
    models      = require('./models'),
    monk        = require('monk')(config.get('MONGO_CONNECTION'));

var app = exports.app = express();

var ADMIN_USER = config.get('ADMIN_USER');
var ADMIN_PASSWORD = config.get('ADMIN_PASSWORD');
var APPROVAL_EMAIL = config.get('APPROVAL_EMAIL');

if (typeof ADMIN_USER === "undefined" || typeof ADMIN_PASSWORD === "undefined") {
  console.error("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!! SHUTTING DOWN: ADMIN_USER or ADMIN_PASSWORD not configured!")
  process.exit(1);
}

//Let's be a strict about which domains can POST, but give wide open CORS for GET endpoints
var postWhiteList = ['http://localhost:8000', 'http://bluebuttonconnector.healthit.gov', 'https://bluebuttonconnector.healthit.gov'];
var corsPostOptions = {
  origin: function(origin, callback){
    var originIsWhitelisted = postWhiteList.indexOf(origin) !== -1;
    callback(null, originIsWhitelisted);
  }
};


//////////////////////////////////////////////////////////////////////////////////////// DB SETUP

var db = {};
db.apps = monk.get('apps');
db.organizations = monk.get('simple_organizations');
db.pending = monk.get('pending');
db.stage2 = monk.get('stage2');

db.apps.index('id', {unique: true }, function (err) {
  if (err) console.log("ERROR CREATING INDEX FOR DB.APPS", err);
});

db.organizations.index('id', {unique: true }, function (err) {
  if (err) console.log("ERROR CREATING INDEX FOR DB.organizations", err);
});

db.stage2.index('zip', {unique: false }, function (err) {
  if (err) console.log("ERROR CREATING INDEX FOR DB.STAGE2.zip", err);
});

db.stage2.index('state', {unique: false }, function (err) {
  if (err) console.log("ERROR CREATING INDEX FOR DB.STAGE2.state", err);
});

db.stage2.index('name', {content: "text", default_language: "english" }, function (err) {
  if (err) console.log("ERROR CREATING INDEX FOR DB.STAGE2.name", err);
});

app.configure(function(){
  app.use(express.bodyParser());
  app.use(express.methodOverride());
  app.use(app.router);
  app.use(iodocs);
});

app.configure('development', function(){
  app.use(express.logger('dev'));
  app.use(express.errorHandler());
});


//////////////////////////////////////////////////////////////////////////////////////// GET

app.get('/:type(organizations|apps)', cors(), function(req, res) {
  var type = req.params.type;
  var dbo = db[type];
  var category = req.query.category ? req.query.category.replace(/[^A-Za-z]+/, '').toLowerCase() : false;
  var offset = req.query.offset ? parseInt(req.query.offset, 10) : 0;
  var limit = req.query.limit ? parseInt(req.query.limit, 10) : 30;
  limit = Math.min(100, limit);

  var qObj = {};
  var fields = {_id: 0};
  var metaObj = {total_results:0, limit:limit, offset:offset};
  if (category) metaObj.category = qObj.category = category;

  dbo.find(qObj, {fields: fields, sort: {id: 1}, skip: offset, limit: limit}, function (err, dbRes) {
    if (err) res.status(500).send(err);
    //get the total count
    dbo.count(qObj, function(err, count) {
      metaObj.total_results = count;
      //include 'next' and 'prev' links for easy traversal
      if (offset + limit < metaObj.total_results) {
        metaObj.next = '/' + type + '?limit=' + limit + '&offset=' + (offset + limit);
        if (category) metaObj.next += '&category=' + metaObj.category;
      }
      if (offset > 0) {
        metaObj.prev = '/' + type + '?limit=' + limit + '&offset=' + (Math.max(offset - limit, 0));
        if (category) metaObj.prev += '&category=' + metaObj.category;
      }
      returnData = {results: dbRes, meta: metaObj};
      res.json(returnData);
    });
  });
});

app.get('/:type(organizations|apps)/:id', cors(), function(req, res) {
  var type = req.params.type;
  var dbo = db[type];
  dbo.findOne({id: req.params.id}, {fields: {_id:0}}, function (err, leObj) {
    if (err) res.status(500).send(err);
    if (leObj == null) {
      res.send(404);
    } else {
      res.json(leObj);
    }
  });
});

//////////////////////////////////////////////////////////////////////////////////////// POST
app.post('/:type(apps|organizations)', cors(corsPostOptions), function(req, res) {
  var type = req.params.type;
  var pObj = models[type].create(req.body);
  if (pObj.error) return res.send(400, pObj);
  //these get stripped from the validated model, so put them back on
  if (req.body.submitter_email) pObj.submitter_email = req.body.submitter_email;
  if (req.body.submitter_reason) pObj.submitter_reason = req.body.submitter_reason;
  pObj.type = type;

  saveAsPending(type, pObj, function(err, pendingRes) {
    if (err) return res.send(500, err);
    res.send(pendingRes);
  });
});

// FOR THE PROTECTED CORS
app.options('/:type(apps|organizations)', cors());


//////////////////////////////////////////////////////////////////////////////////////// PENDING (PROTECTED BY BASIC AUTH)
//// YEAH, PRETTY MESSY
app.get('/pending/:type(organizations|apps)/:id', requireHTTPS, express.basicAuth(ADMIN_USER, ADMIN_PASSWORD), function (req, res) {

  if (req.query.action && !(req.query.action == 'approve' || req.query.action == 'reject')) return res.send(400, "action parameter must be 'approve' or 'reject'");
  var pdbo = db.pending;
  var dbo = db[req.params.type];

  pdbo.findById(req.params.id, function(err, pObj) {
    if (err) return res.send(500);
    if (pObj == null) return res.send(404, "Can't find anything with that ID that has pending updates. Perhaps it has already been either approved or deleted?");
    var idToRemove = pObj._id;

    // Is there an already-approved version of this thing?
    dbo.findOne({id:pObj.id}, function(err, alreadyExists) {
      if (err) return res.send(500);

      if (req.query.action) {
        if (req.query.action == "approve") {
          // strip off the submitter_email and submitter_reason if applicable
          delete pObj.submitter_email;
          delete pObj.submitter_reason;
          delete pObj._id;
          delete pObj.type;
          if (alreadyExists) {
            dbo.updateById(alreadyExists._id, pObj, function(err, updateRes) {
              if (err) return res.send(500, err);
              res.send("Approved. Changes will show up on the live site within 24 hours.");
            });
          } else {
            dbo.insert(pObj, function(err, saveRes) {
              if (err) return res.send(500, err);
              res.send("Approved. Changes will show up on the live site within 24 hours.");
            });
          }
        }

        pdbo.remove({_id:idToRemove}, function(err, removeRes) {
          if (req.query.action == "reject") {
            if (err) return res.send(500, err);
            res.send("<h2>Rejected</h2><p><img src='http://i.giphy.com/DeoY3iC6VLBHG.gif' >");
          }
        });

      } else { // assume we just want to view the pending
        var baseLink = req.originalUrl + "?action=";
        var approveOrRejectLinks = '<h4>You can <a class="btn btn-info" href="'+ baseLink +'approve">approve</a> or <a class="btn btn-danger" href="' + baseLink + 'reject">reject</a> these updates.</h4>';
        var retHTML = '<html><head><link rel="stylesheet" href="https://maxcdn.bootstrapcdn.com/bootstrap/3.3.4/css/bootstrap.min.css"></head><body style="margin:20px;"><div class="container"><div class="table-responsive">';
        if (alreadyExists) {
          retHTML += '<h4>Here are the differences between the existing data and the proposed changes</h4>';
        }
        retHTML += '<table class="table table-striped table-bordered"><thead><tr><th>attribute</th>';
        if (alreadyExists) {
         retHTML +=  '<th>existing</th>';
        }
        retHTML += '<th>proposed</th></tr></thead><tbody>';
        retHTML += objsToTable(pObj, alreadyExists);
        retHTML += '</tbody></table></div>'
        if (pObj.submitter_email) retHTML += "<p>Submitted by: " + pObj.submitter_email + "</p>";
        if (pObj.submitter_reason) retHTML += "<p>Reason given: " + pObj.submitter_reason + "</p>";
        retHTML += approveOrRejectLinks + "</div></body></html>"
        res.send(retHTML);

      }

    });
  });
});

app.del('/:type(organizations|apps)/:id', requireHTTPS, express.basicAuth(ADMIN_USER, ADMIN_PASSWORD), function (req, res) {
  db.apps.remove({id:req.params.id}, function(err, removeRes) {
    if (err) return res.send(500, err);
    res.send("BALETED");
  });
});

////////////////////////////////////////////////////////////////////////////////////// GOOGLE PLAY STORE SCRAPING

app.get('/googleplayreviews/:id', function(req, res) {
  xray('https://play.google.com/store/apps/details?id=' + req.params.id + '&hl=en')
  .select({
    count: '.reviews-num',
    average: '.score',
  })
  .run(function(err, review) {
    if (err) res.send(500, err);
    return res.send(review);
  });

});

//////////////////////////////////////////////////////////////////////////////////////// STAGE 2

app.get('/stage2', cors(), function(req, res) {

  var orgsToSend;
  var offset = req.query.offset ? parseInt(req.query.offset, 10) : 0;
  var limit = req.query.limit ? parseInt(req.query.limit, 10) : 30;
  limit = Math.min(100, limit);

  var metaObj = {total_results:0, limit:limit, offset:offset};
  var fields = '-_id';

  var qObj = {};
  if (req.query.state) {
    qObj.state = req.query.state.toUpperCase();
  }

  if (req.query.zip) {
    qObj.zip = ''+req.query.zip; //yeah, it needs to be a string
  }

  if (req.query.name) {
    //let's be flexible about first/last name ordering and search for both
    var nameBits = req.query.name.split(/[\,?\s?]+/); //break up the two bits on comma and/or space
    var regexString = '^'+nameBits[0];
    if (nameBits.length > 1) {
      regexString = '(' + regexString + '.*' + nameBits[1] +')|(^'+ nameBits[1] + '.*' + nameBits[0] + ')';
    }
    qObj.name = new RegExp(regexString, 'i');
  }

  db.stage2.find(qObj, {fields: fields, sort: {name: 1}, skip: offset, limit: limit}, function (err, docs) {
    if (err) res.status(500).send(err);
    orgsToSend = docs;
    //get the total count
    if (req.query.total_results) { // just a tiny optimization if the requester already knows how many total_results there are.
      metaObj.total_results = req.query.total_results;
      finish();
    } else {
      db.stage2.count(qObj, function(err, count) {
        metaObj.total_results = count;
        finish();
      });
    }

  });

  function finish(){
    var lePath = '/stage2?';
      //include 'next' and 'prev' links for easy traversal
    req.query.limit = limit;
    if (offset + limit < metaObj.total_results) {
      req.query.offset = (offset + limit);
      metaObj.next = lePath + querystring.stringify(req.query);
    }
    if (offset > 0) {
      req.query.offset = (Math.max(offset - limit, 0));
      metaObj.prev = lePath + querystring.stringify(req.query);
    }

    returnData = {results: orgsToSend, meta: metaObj};
    res.json(returnData);
  }

});

//////////////////////////////////////////////////////////////////////////////////////// HELPER FUNCTIONS
function saveAsPending(type, po, cb) {
  var baseLink = 'https://bluebuttonconnectorapi.herokuapp.com/pending/'+ type + '/';
  var emailOptions = {message:''};
  var dbo = db['pending'];

  dbo.insert(po, function(err, saveRes) {
    if (err) {
      console.log("DB SAVING ERROR:", err);
      emailOptions.subject = "BLUE BUTTON SAVING ERROR";
      emailOptions.message = "<p>Problem saving "+ po.id +"</p><pre>" + JSON.stringify(err, null, '\t') + "</pre>";
      sendEmailNotification(emailOptions, function(mailErr, emailRes) {
        cb(err);
      });
    } else {
      baseLink += saveRes._id;
      emailOptions.subject = "Suggested " + type + " : " + po.id;
      if (po.submitter_email) emailOptions.message += "<p>Submitted by: " + po.submitter_email + "</p>";
      if (po.submitter_reason) emailOptions.message += "<p>Reason given: " + po.submitter_reason + "</p>";
      emailOptions.message += "<p><a href='" + baseLink + "'>click to see the details</a> and take action.</p>";
      sendEmailNotification(emailOptions, function(mailErr, emailRes) {
        cb(mailErr, {success: true, saved: saveRes});
      });
    }
  });

}


function objsToTable(proposed, existing) {
  var htmlRows = ''
  var val;
  proposed = flattenObj(proposed);
  if (existing) existing = flattenObj(existing);

  //now make sure all properties across both (if applicable) objects get compared once
  var ref = {};
  for (var a in proposed) {
    if (!ref[a]) {
      ref[a] = true;
      if (existing) {
        if (proposed[a] !== existing[a]) {
          val = (typeof existing[a] == "undefined") ? '' : existing[a];
          htmlRows += "<tr><td>" + a.replace(/___/g, '.') + "</td><td>" + val + "</td><td>" + proposed[a] + "</td></tr>";
        }
      } else {
        htmlRows += "<tr><td>" + a.replace(/___/g, '.');
        htmlRows += "</td><td>" + proposed[a] + "</td></tr>";
      }
    }
  }

  //now list any properties that exist on existing but not proposed
  if (existing) {
    for (var a in existing) {
      if (!ref[a]) {
        htmlRows += "<tr><td>" + a.replace(/___/g, '.') + "</td><td></td><td>" + existing[a] + "</td></tr>";
      }
    }
  }

  return htmlRows;
}

// been a while since I've had fun with recursion
function flattenObj(obj, parent, returnFlat) {
  returnFlat = returnFlat || {}
  for (var a in obj) {
    if (a == "_bsontype" || a == "_id" || a == "type" || a == "updated" || a == "id" || typeof a == "function") continue;
    if (obj.hasOwnProperty(a)) {
      var propName = (parent) ? parent + '___' + a : a;
      if (Object.prototype.toString.call( obj[a] ) === '[object Object]') {
        flattenObj(obj[a], propName, returnFlat);
      } else {
        returnFlat[propName] = obj[a].toString();
      }
    }
  }
  return returnFlat;
}

function requireHTTPS(req, res, next) {
  if (req.headers['x-forwarded-proto'] == 'http') {
    return res.redirect(301, 'https://' + req.headers.host + req.url);
  }
  next();
}

function sendEmailNotification(opt, cb) {
  if ( process.env.NODE_ENV == 'test' ) return cb(null, true);
  var mandrill = require('mandrill-api/mandrill');
  var mandrill_client = new mandrill.Mandrill(config.get('MANDRILL_APIKEY'));

  var message = {
    "html": opt.message,
    "subject": opt.subject,
    "from_email": "bluebutton@limechile.com",
    "from_name": "Connector Bot",
    "to": [{"email":config.get('APPROVAL_EMAIL'),"name":"Jed Wood","type":"to"}],
    "headers": {
        "Reply-To": "bluebutton@limechile.com"
    },
    "important": false,
    "track_opens": false,
    "track_clicks": false,
    "auto_text": null,
    "auto_html": null,
    "inline_css": null,
    "url_strip_qs": null,
    "preserve_recipients": true,
    "view_content_link": true,
    "bcc_address": "bluebutton@limechile.com",
    "tracking_domain": null,
    "signing_domain": null,
    "return_path_domain": null,
    "subaccount": config.get("MANDRILL_SUBACCOUNT")
    };

    var async = false;
    var ip_pool = "Main Pool";

    mandrill_client.messages.send({"message": message, "async": async, "ip_pool": ip_pool}, function(result) {
        cb(null, result)
    }, function(e) {
        console.log('A mandrill (email) error occurred: ' + e.name + ' - ' + e.message);
        cb(e.message);
    });
}


//////////////////////////////////////////////////////////////////////////////////////// FIRE IT UP!
app.listen(config.get('PORT'), function(){
  console.log('BlueButton Connector API listening on port ' + config.get('PORT') + ', running in ' + app.settings.env + ' mode, Node version is: ' + process.version);
});
