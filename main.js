// deps -> node 0.12.12
var http = require('http');
var spawn = require('child_process').spawn;
var qs = require('querystring');
var emitter = require('events').EventEmitter;
var url = require('url');
var sha1 = require('sha1');
var mysql = require('mysql');
var util = require('util');
var fs = require('fs');
var IncomingForm = require('formidable').IncomingForm;

var App = function() { 
  
  this.user =  'admin';
  this.password =  '';
  this.database = 'meta';
  this._fileRoot = "http://dev.pcontact.org:9003/";
  this._staticRoot = "http://dev.pcontact.org/XMPEditor/";
  // the mysql table containing the schema
  this.table = 'media';
  
  
  // 
  // the file metadata
  // table -> the mysql table containing the schema
  // the actual files are stored on disk
  
  this.schema = {
    id: "",
    kind: 0,
    url: "",
    metadata: "",
    filepath: "",
    created_at: new Date(),
    updated_at: new Date(),
    size: 0,
    tags: ""
  };
  
  
  return {
    user: this.user,
    password: this.password,
    database: this.database,
    table: this.table,
    schema: this.schema,
    _staticRoot : this._staticRoot
  };
};

App.Utils = {};

/**
 * 
 * @param {Array} listItems
 * @param {String} joinString
 * @return {Array}
 * 
 * Takes a nested list of tuples (two-item lists) {listItems} and returns the list flattened
 * by joinString
 */
App.Utils.flattenListWithJoinString = function(listItems, joinString) {
  
  joinString = joinString || "";
  for (var pairId in listItems) { 
    listItems[pairId] = listItems[pairId].join(joinString);
  }
  return listItems;
};

/**
 * 
 * @param {Array} listItems
 * @return {Array}
 * 
 * Takes a nest list
 */

App.Utils.flattenList = function(listItems) { 
  return App.Utils.flattenListWithJoinString(listItems);
};

// create the app and the connection to the database
var app = new App();

app.client = mysql.createConnection(app);

// TODO: validate on this!
app.Kinds = ["image/png", "image/jpeg", "image/gif", "image/pdf", "image/swf"];

// the current app schema
app.ActiveRecord = app.schema;
// the keys as a list
app.DataFields = Object.keys(app.ActiveRecord); 

// This ORM is NOT used for file upload. only for metadata access.
app.DataAccess = {
  
  getOne: function() { 
    return 'SELECT '+app.DataFields.join(',')+' FROM '+app.table+' WHERE ID = ?';
  },
  
  setOne: function(id, fieldName, fieldValue) { 
    return 'UPDATE '+app.table+' SET ' + fieldName + '=' +fieldValue+' WHERE ID='+id;
  },
  
  setAll: function(id, fieldNameValueList) { 
    var flatList = App.Utils.flattenListWithJoinString(fieldNameValueList, " = ");
    return 'UPDATE '+app.table+' SET ' + flatList.join(' , ')+' WHERE ID='+id;
  },
  
  addOne: function(ValueList) { 
    // takes a list of values, appends them together and inserts them into the database
    return 'INSERT INTO '+app.table+' VALUES ('+ValueList.join(' , ')+')';
  }
  
};

app.Router = {
  "/m/store": {
    "documentation": "The endpoint for the metadata catalog. Query or store objects in the catalog. Does not handle file uploads",
    "methods": "GET, POST",
    "params": {
      "path": "th realtive path of the url",
      "u": "urlencoded url to hold the embedded files",
      "id": "the id of metadata file",
      "kind": "the document kind (suffix) for the data, see app.Kinds.indexOf(file.type) for the values",
      "tags": "comma seperated list of tags for the file",
      "size": "the size of the file",
      "p": "urlencoded full path of the file",
    }
  },
  "/m/upload": {
    "documentation": "The upload server for the files. Stores both the file and the metadata. Uses /m/store to catalog stores",
    "methods": "POST"
  },
  "/m/files": { 
    "documentation": "The static store root for the files. Store and retrieve the files only. ",
    "methods": "GET"
  },
  "/m/([^/]+\/)+": { 
    "documentation": "Query the catalog for the file with url that matches the route, return the metadata for the file as xml or json (now only works with xml). This is the xmp endpoint"
  }
};

app.Event = {};

app.Views = {
  // nmm:ns:crewml -> http://www.newmediameltdown.com/2009/crewml
  // nmm:ns:stuml -> http://www.newmediameltdown.com/2009/stuml
  // nmm:ns:nmmwidget -> http://www.newmediameltdown.com/2009/nmmwidget
  root: {
    head: "<html xmlns=\"http://www.w3.org/1999/xhtml\" \
    xmlns:fb=\"http://www.facebook.com/2008/fbml\" \
    xmlns:xmp=\"http://ns.adobe.com/xap/1.0/mm\" \
    xmlns:nmmcml=\"nmm:ns:crewml\" \
    xmlns:nmmstuml=\"nmm:ns:stuml\" \
    xmlns:nmm=\"nmm:ns:nmmwidget\" \
    xmlns:xmptop=\"x:xmpmeta\" \
    xmlns:xmpadb=\"x:adobe:ns:meta/\" \
    xmlns:xmpver=\"5.1.2\"> \
    <head> \
    <script type=\"text/javascript\" src=\""+app._staticRoot+"libs/contrib/jquery/dist/jquery.js\"></script> \
    <script type=\"text/javascript\" src=\""+app._staticRoot+"libs/fields.js\"></script> \
    <script type=\"text/javascript\" src=\""+app._staticRoot+"libs/home_link.js\"></script> \
    <script type=\"text/javascript\" src=\""+app._staticRoot+"libs/splash.js\"></script>  \
    <script type=\"text/javascript\" src=\""+app._staticRoot+"libs/transport.js\"></script> \
    <meta content=\"text/html; charset=UTF-8\" http-equiv=\"Content-Type\" /> \
    <meta content=\"optimize, media, google search, seo, optimize media\"  name=\"keywords\"/> \
    <meta content=\"New Media Meltdown\" name=\"Author\"/> \
    <title>The New Media Meltdown - Google optimize your images</title> \
    <link rel=\"stylesheet\" type=\"text/css\" href=\""+app._staticRoot+"styles/nmmsplash.css\"/> \
    <link rel=\"icon\" type=\"image/x-icon\" href=\""+app._staticRoot+"images/favicon.ico\" /> \
    </head>"
  },
  body: "",
  foot: ""
};

http.createServer(function(request, response) { 
 
  // if it's an upload, parse the file and handle the upload, storing the file metadata
  // in the catalogue
  
  console.log("routing: " + request.url + ' method: ' + request.method);
  
  if (request.url == "/m/upload" && request.method.toLowerCase() == 'options') {
    response.writeHead(501,
      {'Access-Control-Allow-Origin': '*',
       'Access-Control-Allow-Headers': 'X-Requested-With, Content-Type, X-PINGOTHER, X-File-Name, Cache-Control',
       'Access-Control-Allow-Methods': 'PUT, POST, GET, OPTIONS'});
     
    response.end("<div>Not implemented</div>");
    
  }
  
  if (request.url == "/m/upload" && request.method.toLowerCase() == 'post') { 
    
    //console.log("uploading file");
    // run our image uploader. 
    var form = new IncomingForm();
    var files = [];
    var fields = [];
    // make sure the type is not included
    form.keepExtensions = true;
    form.maxFileSize = 10 * 1024 * 1024; // 10MB
    // run a hash on the file, TODO: store this
    form.hash = 'sha1';
    // grab the upload directory
    form.uploadDir = fs.realpathSync("./media");
    //console.log("uploading...");
    // form methods
    
    form.on('field', function(field, value) { 
      //console.log(field, value);
      fields.push([field, value]);
    })
    .on('file', function(field, file) { 
      //console.log(field, file);
      files.push([field, file]);
    })
    .on('end', function() { 
      //console.log("Upload done");
      //console.log('received files:\n\n '+util.inspect(files));
      // ok, upload is complete, dump the xmp data
      if (files) { 
        //console.log("filename: " + util.inspect(files[0][1]));
        // the file object is the second item in the list
        var f = files[0].pop();
        var xmpRunner = spawn('dumpxmp', [f.path]);
        var xmpData = '';
        xmpRunner.stdout.on('data', function(data) { 
          xmpData += data;
        });
      
     
        xmpRunner.on('close', function(code, signal) { 
          // upload our XMP data to our SQL server
          console.log("xmpData: " + xmpData);
          // create a http request and upload the XMP data
          var req = http.request({
            hostname: 'dev.pcontact.org',
            port: 8127,
            path: '/m/store',
            method: 'POST',
            headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': xmpData.length,
          }
        });
        console.log("Doing SQL POST");
        req.write("metadata="+encodeURIComponent(xmpData));
        console.log("Finished");
      });
    }
    });
    // do the upload and store the data in the catalog
    form.parse(request);
  } 
  
  // if its a post on the store, parse the params and store the catalog metadata. 
  // we access this method after uploading files
  // we also do it directly to store metadata for URLs directly
  if (request.url == "/m/store" && request.method.toLowerCase() == 'post') { 
    var query = qs.parse(request.url, true);
    console.log("query: " + query);
    var kind = query.kind ? query.kind : 'NULL';
    var path = query.path ? query.path : 'NULL';
    var created_at = Date.now();
    // TODO: timestamp!
    var updated_at = 'NULL'; 
    // if the path is passed, but the url is not, calculate the url from the path
    if ((path && path != 'NULL') && (typeof query.u == "undefined")) { 
      var url = app._staticRoot + path; 
    }
    else { 
      // otherwise use the url passed, or null
      var url = query.u || 'NULL';
    }
    var tags = query.tags || 'NULL';
    // see http://stackoverflow.com/questions/4295782/how-do-you-extract-post-data-in-node-js
    var body = '';
    request.on('data', function(data) { 
      body += data;
      // 1e6 === 1 * Math.pow(10, 6) === 1 * 1000000 ~~~ 1MB
      if (body.length > 1e20) { 
        request.connection.destroy();
      }
    });
    request.on('end', function() { 
      // TODO: run the SQL query here..
      var post = qs.parse(body);
      //console.log(post);
      var xmpData = app.client.escape(post['metadata']);
      var fieldData = ['NULL', kind, url, path, '"'+xmpData+'"', created_at, updated_at, xmpData.length, tags];
      var sql = app.DataAccess.addOne(fieldData);
      console.log(sql);
      app.client.query(sql, function(err, rows) { 
        if (err) { console.log(err); }
        else { 
          //response.write(302, {'Location': '/'});
        }
      });
    });
  }
  
  
  else if (request.url == "/m/store" && request.method.toLowerCase() == 'get') { 
    
    console.log("routing: " + request.url);
    
    var query = url.parse(request.url, true).query; // DUMP || WRITE
    var id = query.id ? query.id : 1;
    var sql = app.DataAccess.getOne(id);
    app.client.query(sql, function(err, rows) { 
      if (err) { console.log(err); }
      else { 
        // just write a default response with the metadata
        response.writeHead(200, {
          'Content-Type': "application/json; charset=utf-8",
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'X-Requested-With, Content-Type, X-PINGOTHER, X-File-Name, Cache-Control',
          'Access-Control-Allow-Methods': 'PUT, POST, GET, OPTIONS'
        });
  
        response.end(JSON.stringify(rows[0]));
      }
    });
  };
  
  response.writeHead(200, {
    'Content-Type': "application/json; charset=utf-8",
  });
  
  response.end(JSON.stringify({'response': 'OK'}));
  
}).listen(8127);