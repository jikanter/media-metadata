/* 
 * Copyright (c) 2015 Jordan Kanter. All rights reserved. 
 */
var express = require('express');
var app = express();

app.use('/', express.static('media'));

var server = app.listen(process.env.PORT || 9003, function() {
  
  console.log('Listening on port %d', server.address().port);
  
});

