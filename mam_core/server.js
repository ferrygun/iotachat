/*eslint no-console: 0, no-unused-vars: 0, no-undef:0, no-process-exit:0*/
/*eslint-env node, es6 */
"use strict";
const port = process.env.PORT || 3000;
const server = require("http").createServer();

const cds = require("@sap/cds");
//Initialize Express App for XSA UAA and HDBEXT Middleware
const xsenv = require("@sap/xsenv");
const passport = require("passport");
const xssec = require("@sap/xssec");
const xsHDBConn = require("@sap/hdbext");
const express = require("express");
global.__base = __dirname + "/";

//Iota 
const Mam = require('./lib/mam.client.js');
const IOTA = require('iota.lib.js');
const iota = new IOTA({
	provider: 'https://node.deviceproof.org'
});

const MODE = 'restricted'; // public, private or restricted
const SIDEKEY = 'mysecret'; // Enter only ASCII characters. Used only in restricted mode

let root;
let key;
let Socket = null;

//logging
var logging = require("@sap/logging");
var appContext = logging.createAppContext();

//Initialize Express App for XS UAA and HDBEXT Middleware
var app = express();

//Compression
app.use(require("compression")({
	threshold: "1b"
}));

//Helmet for Security Policy Headers
const helmet = require("helmet");
app.use(helmet());
app.use(helmet.contentSecurityPolicy({
	directives: {
		defaultSrc: ["'self'"],
		styleSrc: ["'self'", "sapui5.hana.ondemand.com"],
		scriptSrc: ["'self'", "sapui5.hana.ondemand.com"]
	}
}));
// Sets "Referrer-Policy: no-referrer".
app.use(helmet.referrerPolicy({
	policy: "no-referrer"
}));

passport.use("JWT", new xssec.JWTStrategy(xsenv.getServices({
	uaa: {
		tag: "xsuaa"
	}
}).uaa));
app.use(logging.middleware({
	appContext: appContext,
	logNetwork: true
}));
app.use(passport.initialize());
app.use(
	passport.authenticate("JWT", {
		session: false
	})
);

// Initialise MAM State
let mamState = Mam.init(iota);

// Set channel mode
if (MODE == 'restricted') {
    key = iota.utils.toTrytes(SIDEKEY);
    mamState = Mam.changeMode(mamState, MODE, key);
} else {
    mamState = Mam.changeMode(mamState, MODE);
}

// Publish data to the tangle
const publish = async function(packet) {
    // Create MAM Payload
    const trytes = iota.utils.toTrytes(JSON.stringify(packet));
    const message = Mam.create(mamState, trytes);

    // Save new mamState
    mamState = message.state;
    console.log('Root: ', message.root);
    console.log('Address: ', message.address);
	
    // Attach the payload.
    await Mam.attach(message.payload, message.address);

    return message.root;
}

const generateJSON = function(message) {
	const json = {"message": message};
    return json;
}

const executeDataPublishing = async function(message) {
    const json = generateJSON(message);
    const root = await publish(json);
}

//Start the Server 
server.on("request", app);

// use socket.io
var io = require('socket.io').listen(server);
// define interactions with client
io.sockets.on('connection', function (socket) {
	Socket = socket;
	console.log('New user connected')
	
    //listen on new_message from GUI
    socket.on('new_message', (data) => {
		//send to Tangle
		console.log(data.message);
		executeDataPublishing(data.message);
    })
});

//Start the Server 
server.listen(port, function () {
	console.info(`HTTP Server: ${server.address().port}`);
});


//////////////////////////////////////////////////////////////////////////

// Receive data from the tangle
const executeDataRetrieval = async function(rootVal, keyVal) {
    let resp = await Mam.fetch(rootVal, MODE, keyVal, function(data) {
        let json = JSON.parse(iota.utils.fromTrytes(data));

		if(Socket !== null) {
			io.emit('new_message_tangle', {message : json.message});
			console.log("message:" + json.message);
		}
    });

    executeDataRetrieval(resp.nextRoot, keyVal);
}

const startPublishing = async function() {
    const json = generateJSON("dummy");

    const root = await publish(json);
    executeDataRetrieval(root, key);
}

startPublishing();

