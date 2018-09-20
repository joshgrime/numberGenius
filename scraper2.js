const express = require('express');
const app = require('express')();
const server = require('http').Server(app);
const io = require('socket.io')(server);
const mysql = require('mysql');
const fs = require('fs');
const puppeteer = require('puppeteer');

var connection;
server.listen(3000);

function retrieveCredentials (callback) {
var credentials = '';
var getPasswords = fs.createReadStream('credentials.json');
getPasswords.on('data', function (x) {
  credentials += x;
});
getPasswords.on('error', function (e) {
  console.log('Error reading db credentials:\n'+e);
});
getPasswords.on('end', function () {
  credentials = JSON.parse(credentials);
  callback(credentials);
});
}

function connectToDb(credentials){
  connection = mysql.createConnection({
    host     : credentials.host,
    user     : credentials.username,
    password : credentials.password,
    database : credentials.db
  });
  connection.connect();
}

retrieveCredentials(connectToDb);

app.use(express.static('public'));
app.get('/', function (req, res) {
  res.sendFile(__dirname + '/public/index.html');
});

io.on('connection', function (socket) {

  socket.on('scrapeRequest', function(data) {
    scrape(data);
  });

});

async function scrape (options) {
var navigateTo = options.url;
navigateTo = 'http://'+navigateTo;
console.log('Loading up next page:...\n'+navigateTo);

  puppeteer.launch().then(async browser => {
    try {
    const page = await browser.newPage();
    await page.goto(navigateTo);
    var hrefs = await page.evaluate(function() {
      var urls = [];
      var anchors = document.getElementsByTagName('a');
      for (let x of anchors) {
        if (x.href !== undefined && x.href.includes('http')) {
          urls.push(x.href);
        }
      }
      return urls;
      });

      var numbers = await page.evaluate(function() {
      var regex = /(((?:.\d)|(?:\d.)|(?:\d))|(?:.\d)|(?:..\d)){1,18}/;
      var digits = [];
      var elements = document.querySelectorAll('*:not(script)');
      for (let x of elements) {
        if (x.innerText != undefined) {
          var match = x.innerText.match(regex);
          if (match != '' && match != null && match[0].length > 10) {
            digits.push(match[0]);
            }
          }
        }
        var unique_array = digits.filter(function(elem, index, self) {
        return index == self.indexOf(elem);
        });
      return unique_array;
    });
    if (options.id !== 'first') {markUrlComplete(options.id);}
    writeToDb({'links':hrefs,'numbers':numbers, 'page':navigateTo}, scrape);
}
catch (err) {
  console.log('Scrape on '+options.url+' was unsuccessful:\n'+err+'\nTrying a new link in 2 seconds.');
  if (options.id !== 'first') {markUrlComplete(options.id);}
  var randomQuery = await queryDBPromisified();
  var nextUrl = randomQuery[0].url;
  var nextId = randomQuery[0].id;
  setTimeout(function(){
  scrape({url:nextUrl, id:nextId});
}), 2000}
finally {
  browser.close();
}
});



}


async function writeToDb(object, callback) {
  var today = new Date();
  var day = today.getDate();
  var month = today.getMonth();
  var year = today.getFullYear();
  var hour = today.getHours();
  var minute = today.getMinutes();
  var second = today.getSeconds();

  var date = year+'-'+month+'-'+day;
  var time = hour+':'+minute+':'+second;

  var linkCount = 0;
  var linkErrors = 0;
  var numberCount = 0;
  var numberErrors = 0;

  for (let x of object.links) {

    if (x.startsWith('https://wwww.')) x = x.substring(13, x.length);
    if (x.startsWith('http://www.')) x = x.substring(12, x.length);
    if (x.startsWith('https://')) x = x.substring(8, x.length);
    if (x.startsWith('http://')) x = x.substring(7, x.length);
    if (x.startsWith('www.')) x = x.substring(4, x.length);

    var urlEntry = {date: date, time: time, url: x};

    connection.query('INSERT INTO url_pile SET ?', urlEntry, (err, res) => {
      if(err) {linkErrors++;}
      else {
      linkCount++;
    }
    });
  }

  for (let y of object.numbers) {
    var numberEntry = {number: y};
    connection.query('INSERT INTO numberDatabase SET ?', numberEntry, (err, res) => {
      if(err) {numberErrors++; console.log('fkn error '+err);}
      else {
        numberCount++;
      }
    });
  }

  var randomQuery = await queryDBPromisified();
  var nextUrl = randomQuery[0].url;
  var nextId = randomQuery[0].id;
  console.log('Added <<'+linkCount+'>> links! ('+linkErrors+') errors.');
  console.log('Added <<'+numberCount+'>> new potential numbers! ('+numberErrors+') errors.');
  callback({url:nextUrl, id:nextId});
}

function queryDBPromisified () {
    var dbPromise = new Promise((resolve, reject) => {
          connection.query('SELECT * FROM url_pile WHERE done=0 ORDER BY RAND() LIMIT 1;', (err, res) => {
  			    if(err){
              console.log('FATAL ERROR READING NEXT URL FROM DB!');
  			    	reject(err);
  			    }else {
  			    	resolve(res);
  			    }
  			    });
      });
      return dbPromise;
}

function markUrlComplete(rowId) {
  connection.query('UPDATE url_pile SET done = 1 WHERE id="'+rowId+'";', (err, res) => {
    if(err){
      console.log('FATAL ERROR READING NEXT URL FROM DB!');
    }
    });
}
