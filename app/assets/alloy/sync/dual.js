var _ = require('alloy/underscore')._;
var Alloy = require('alloy');

var ALLOY_DB_DEFAULT = '_alloy_';
var ALLOY_ID_DEFAULT = 'alloy_id';
var ALLOY_MODIFIED_DEFAULT = 'modified_at'

function S4() {
	return (((1+Math.random())*0x10000)|0).toString(16).substring(1);
}

function guid() {
	return (S4()+S4()+'-'+S4()+'-'+S4()+'-'+S4()+'-'+S4()+S4()+S4());
}

var cache = {
	config: {},
	Model: {}
};

// SOURCE: https://github.com/appcelerator/alloy/blob/master/Alloy/lib/alloy/sync/sql.js
// 변경사항 추적해야함 - sep 18, 2013

// The sql-specific migration object, which is the main parameter
// to the up() and down() migration functions.
//
// db            The database handle for migration processing. Do not open
//               or close this as it is a running transaction that ensures
//               data integrity during the migration process.
// dbname        The name of the SQLite database for this model.
// table         The name of the SQLite table for this model.
// idAttribute   The unique ID column for this model, which is
//               mapped back to Backbone.js for its update and
//               delete operations.
function Migrator(config, transactionDb) {
	this.db = transactionDb;
	this.dbname = config.adapter.db_name;
	this.table = config.adapter.collection_name;
	this.idAttribute = config.adapter.idAttribute;

	//TODO: normalize columns at compile time - https://jira.appcelerator.org/browse/ALOY-222
	this.column = function(name) {
		// split into parts to keep additional column characteristics like
		// autoincrement, primary key, etc...
		var parts = name.split(/\s+/);
		var type = parts[0];
		switch(type.toLowerCase()) {
			case 'string':
			case 'varchar':
			case 'date':
			case 'datetime':
				Ti.API.warn('"' + type + '" is not a valid sqlite field, using TEXT instead');
			case 'text':
				type = 'TEXT';
				break;
			case 'int':
			case 'tinyint':
			case 'smallint':
			case 'bigint':
			case 'boolean':
				Ti.API.warn('"' + type + '" is not a valid sqlite field, using INTEGER instead');
			case 'integer':
				type = 'INTEGER';
				break;
			case 'double':
			case 'float':
			case 'decimal':
			case 'number':
				Ti.API.warn('"' + name + '" is not a valid sqlite field, using REAL instead');
			case 'real':
				type = 'REAL';
				break;
			case 'blob':
				type = 'BLOB';
				break;
			case 'null':
				type = 'NULL';
				break;
			default:
				type = 'TEXT';
				break;
		}
		parts[0] = type;
		return parts.join(' ');
	};

	this.createTable = function(config) {
		// compose the create query
		var columns = [];
		var found = false;
		for (var k in config.columns) {
			if (k === this.idAttribute) { found = true; }
			columns.push(k + " " + this.column(config.columns[k]));
		}

		// add the id field if it wasn't specified
		if (!found && this.idAttribute === ALLOY_ID_DEFAULT) {
			columns.push(ALLOY_ID_DEFAULT + ' TEXT UNIQUE');
		}
		var sql = 'CREATE TABLE IF NOT EXISTS ' + this.table + ' ( ' + columns.join(',') + ')';

		// execute the create
		this.db.execute(sql);
	};

	this.dropTable = function() {
		this.db.execute('DROP TABLE IF EXISTS ' + this.table);
	};

	this.insertRow = function(columnValues) {
		var columns = [];
		var values = [];
		var qs = [];

		// get arrays of column names, values, and value placeholders
		var found = false;
		for (var key in columnValues) {
			if (key === this.idAttribute) { found = true; }
			columns.push(key);
			values.push(columnValues[key]);
			qs.push('?');
		}

		// add the id field if it wasn't specified
		if (!found && this.idAttribute === ALLOY_ID_DEFAULT) {
			columns.push(this.idAttribute);
			values.push(guid());
			qs.push('?');
		}

		// construct and execute the query
		this.db.execute('INSERT INTO ' + this.table + ' (' + columns.join(',') + ') VALUES (' + qs.join(',') + ');', values);
	};

	this.deleteRow = function(columns) {
		var sql = 'DELETE FROM ' + this.table;
		var keys = _.keys(columns);
		var len = keys.length;
		var conditions = [];
		var values = [];

		// construct the where clause, if necessary
		if (len) { sql += ' WHERE '; }
		for (var i = 0; i < len; i++) {
			conditions.push(keys[i] + ' = ?');
			values.push(columns[keys[i]]);
		}
		sql += conditions.join(' AND ');

		// execute the delete
		this.db.execute(sql, values);
	};
}

// http network object
//
// options	timeout 	in milliseconds
//			method		get, post, put, delete
//			path
//			headers
//			data		post data
//
// callback	success
//			code
//			data
//			responseText
//			responseJSON
//			offline
//
function API(options, callback) {
	// testing code
	if (options.stub) {
		callback({
			success: true,
			code: 200,
			responseText: options.stub,
			responseJSON: options.stub,
		});
		return;
	}
	
	if (Ti.Network.online) {
		var xhr = Ti.Network.createHTTPClient({
			timeout : options.timeout || 7000
		});

		// rest api host
		var url = Alloy.Globals.host + options.path;

		xhr.open(options.method, url);

		xhr.onload = function() {
			var responseJSON, success = true, error;
			if (xhr.responseText && xhr.responseText.trim() != "") {
				try {
					responseJSON = JSON.parse(xhr.responseText);
				} catch (e) {
					Ti.API.error("API ERROR:  " + e.message);
					Ti.API.error(xhr.responseText);
					success = false;
					error = e.message;
				}
			}
			callback({
				success: success,
				code: xhr.status,
				data: error,
				responseText: xhr.responseText || null,
				responseJSON: responseJSON || null,
			});
        };
		xhr.onerror = function() {
			var responseJSON, error;
			try {
				responseJSON = JSON.parse(xhr.responseText);
			} catch (e) {
				error = e.message;
			}

			Ti.API.error("API ERROR:  " + xhr.status);
			Ti.API.error(xhr.responseText);
			
			callback({
				success: false,
				code: xhr.status,
				data: error,
				responseText: xhr.responseText || null,
				responseJSON: responseJSON || null,
			});
		};

		// authentication token
		var authToken = Alloy.Globals.readFromSession && Alloy.Globals.readFromSession("auth_token");
		if (authToken) {
			xhr.setRequestHeader("X-Auth-Token", authToken);
		}
		// current language
		xhr.setRequestHeader("X-Language", Ti.Locale.currentLanguage);
		// custom
		for (var header in options.headers) {
			xhr.setRequestHeader(header, options.headers[header]);
		}
		
		xhr.send(options.data || null);
    }
	else {
		// offline
		callback({
			success: false,
			responseText: null,
			offline: true
		});
	}
}

// model.config		debug
//					modifiedColumn
//					rootNode
//					name
// 
// dual 모드 시나리오 (remote api에는 실제 데이터, sql은 로컬 캐쉬처럼 동작한다고 생각)
//	- sql에만 Read/Write
//	- api로만 Read/Write
//	- sql에서 Read하고 api에서 Read가 성공하면 sql 업데이트하고 다시 화면 업데이트
//	- api로 Write 성공한 경우에만 sql에 Write
//	- sql에 Write하고 api에 Write하고 성공할때까지 poll & retry
//
function Sync(method, model, opts) {
    var table = model.config.adapter.collection_name,
		columns = model.config.columns,
		dbName = model.config.adapter.db_name || ALLOY_DB_DEFAULT,
		nodeName = model.config.adapter.nodeName || model.config.adapter.collection_name,
		rootNode = model.config.adapter.rootNode || model.config.adapter.collection_name + "s",
		urlRoot = model.config.urlRoot || "/" + model.config.adapter.collection_name + "s",
		resp = null,
		db, sql;

	var DEBUG = model.config.debug;
	var modifiedColumn = model.config.adapter.modifiedColumn || ALLOY_MODIFIED_DEFAULT;
	
	// api			api만 사용
	// transaction	sql, api 모두 사용. 다만 write시 api가 성공해야 sql에 저장함
	// active		sql, api 모두 사용. 먼저 sql에 write하고 api에 계속 sync 시도함
	// 
	// 개별 model마다 따로 지정할수있고, default값으로 model.config 참조
	var syncMode = model.syncMode || model.config.adapter.syncMode || "api";


	// model.idAttribute = model.config.adapter.idAttribute;
	//fix for collection
	// var isCollection = ( model instanceof Backbone.Collection) ? true : false;
	// var initFetchWithLocalData = model.config.initFetchWithLocalData;

	// var singleModelRequest = null;
	// if (lastModifiedColumn) {
	//         if (opts.sql && opts.sql.where) {
	//                 singleModelRequest = opts.sql.where[model.idAttribute];
	//         }
	//         if (!singleModelRequest && opts.data && opts.data[model.idAttribute]) {
	//                 singleModelRequest = opts.data[model.idAttribute];
	//         }
	// }

	var HTTP_METHODS = {
		create: 'POST',
		read: 'GET',
		update: 'PUT',
		delete: 'DELETE',
	};
	
	var httpMethod = HTTP_METHODS[method];
	var params = _.extend({}, opts);
	params.method = httpMethod;
	params.headers = params.headers || {};
	if (model.config.hasOwnProperty("headers")) {
		for (header in model.config.headers) {
			params.headers[header] = model.config.headers[header];
		}
	}
	params.stub = model.stub; // test stub
	
	// loading 이벤트
	// - 주로 indicator 표시를 위해 사용
	model.trigger("loading", {
		method: method, 
		params: model.params, 
		pagination: (method == 'read' && (model.params && parseInt(model.params.page) > 0)) // pagination인 경우
	});
	
	
	function wrapWithNodeName(d) {
		if (nodeName) {
			var h = {};
			h[nodeName] = _.clone(d);
			return h;
		} else {
			return d;
		}
	}
	
    function unwrapWithRootNode(d) {
		var data = d;
		if (_.isFunction(rootNode)) {
			data = rootNode(data);
		} else if (!_.isUndefined(rootNode)) {
			var nodes = rootNode.split(",");
			for (var i=0; i < nodes.length; i++) {
				if (data) { data = data[nodes[i]]; }
			}
		}
		return data;
    }
	
	function dirtyAttributes(m) {
		console.log(JSON.stringify(opts));
		// TODO: calc dirty attributes
		return m.toJSON();
	}
	
	function makeResourcePath(basePath, modelParams, attrs, _id) {
		var s = '' + basePath;
		// TODO: attrs
		
		if (_id) {
			s = s + "/" + _id;
		}
		if (modelParams) {
			var actionName = modelParams.action || modelParams.action_name;
			if (actionName) {
				s = s + "/" + actionName;
			}
			var args = [];
			_.each(_.omit(modelParams, actionName), function(v,k) {
				if (!_.isEmpty(k)) { args.push(k + "=" + v); }
			});
			if (args.length > 0) {
				s = s + "?" + args.join("&");
			}
		}
		return s;
	}
	
	function saveToSQL(data) {
		console.log("saveToSQL");
	}
	
	function readSQL() {
		console.log("readSQL");
	}
	
	function deleteSQL() {
		console.log("deleteSQL");
	}
	
	
	switch (method) {
		case 'read':
			params.path = makeResourcePath(urlRoot, model.params, model.attributes, model.id);
			
			// 먼저 sql에서 읽어들이고
			if (syncMode != "api") {
				var data = readSQL();
				_.isFunction(params.success) && params.success(data);
				model.trigger("fetch", { localData: true });
			}
			
			// api에서 읽어들인값을 sql에 반영
			API(params, function(response) {
				if (response.success) {
					var resp = unwrapWithRootNode(response.responseJSON) || response.responseJSON;
					
					// 성공한경우 transaction,active mode이면 sql에 반영
					if (syncMode == "transaction" || syncMode == "active") {
						saveToSQL(resp);
					}
					
					var data = readSQL();
					_.isFunction(params.success) && params.success(data);
					model.trigger("fetch");
                }
				else {
					var data = readSQL();

					// offline인경우 error는 발생시키지 않음
					if (response.offline) {
						_.isFunction(params.success) && params.success(data);
					}
					else {
						_.isFunction(params.error) && params.error(data);
					}
                }
			});
			break;
			
		case 'create':
			params.path = makeResourcePath(urlRoot, model.params, model.attributes);
			params.data = wrapWithNodeName(model.toJSON()); // create때는 모든 속성을 저장해야함
			
			// api 저장
			API(params, function(response) {
				if (response.success) {
					var data = unwrapWithRootNode(response.responseJSON);
					
					// 성공한경우 transaction,active mode이면 sql에 반영
					if (syncMode == "transaction" || syncMode == "active") {
						saveToSQL(data);
					}
					
					_.isFunction(params.success) && params.success(data);
                }
				else {
					var data = params.data;
					
					// offline인경우 active mode이면 sql에 반영
					if (response.offline && syncMode == "active") {
						saveToSQL(data);
						_.isFunction(params.success) && params.success(data);
					}
					else {
						_.isFunction(params.error) && params.error(data);
					}
                }
			});
			break;
			
		case 'update':
			params.path = makeResourcePath(urlRoot, model.params, model.attributes, model.id);
			params.data = wrapWithNodeName(dirtyAttributes(model));
			
			// api 저장
			API(params, function(response) {
				if (response.success) {
					var data = unwrapWithRootNode(response.responseJSON);
					
					// 성공한경우 transaction,active mode이면 sql에 반영
					if (syncMode == "transaction" || syncMode == "active") {
						saveToSQL(data);
					}
					
					_.isFunction(params.success) && params.success(data);
                }
				else {
					var data = params.data;
					
					// offline인경우 active mode이면 sql에 반영
					if (response.offline && syncMode == "active") {
						saveToSQL(data);
						_.isFunction(params.success) && params.success(data);
					}
					else {
						_.isFunction(params.error) && params.error(data);
					}
                }
			});
			break;
			
		case 'delete':
			params.path = makeResourcePath(urlRoot, model.params, model.attributes, model.id);
			
			// api 저장
			API(params, function(response) {
				if (response.success) {
					var data = unwrapWithRootNode(response.responseJSON);
					
					// 성공한경우 transaction,active mode이면 sql에 반영
					if (syncMode == "transaction" || syncMode == "active") {
						deleteSQL();
					}
					
					_.isFunction(params.success) && params.success(data);
                }
				else {
					var data = readSQL();
					
					// offline인경우 active mode이면 sql에 반영
					if (response.offline && syncMode == "active") {
						deleteSQL();
						_.isFunction(params.success) && params.success(data);
					}
					else {
						_.isFunction(params.error) && params.error(data);
					}
                }
			});
			break;
	}


}



// SOURCE: https://github.com/appcelerator/alloy/blob/master/Alloy/lib/alloy/sync/sql.js
// 변경사항 추적해야함 - sep 18, 2013

function GetMigrationFor(dbname, table) {
	var mid = null;
	var db = Ti.Database.open(dbname);
	db.execute('CREATE TABLE IF NOT EXISTS migrations (latest TEXT, model TEXT);');
	var rs = db.execute('SELECT latest FROM migrations where model = ?;', table);
	if (rs.isValidRow()) {
		mid = rs.field(0) + '';
	}
	rs.close();
	db.close();
	return mid;
}

function Migrate(Model) {
	// get list of migrations for this model
	var migrations = Model.migrations || [];

	// get a reference to the last migration
	var lastMigration = {};
	if (migrations.length) { migrations[migrations.length-1](lastMigration); }

	// Get config reference
	var config = Model.prototype.config;

	// Get the db name for this model and set up the sql migration obejct
	config.adapter.db_name = config.adapter.db_name || ALLOY_DB_DEFAULT;
	var migrator = new Migrator(config);

	// Get the migration number from the config, or use the number of
	// the last migration if it's not present. If we still don't have a
	// migration number after that, that means there are none. There's
	// no migrations to perform.
	var targetNumber = typeof config.adapter.migration === 'undefined' || config.adapter.migration === null ? lastMigration.id : config.adapter.migration;
	if (typeof targetNumber === 'undefined' || targetNumber === null) {
		var tmpDb = Ti.Database.open(config.adapter.db_name);
		migrator.db = tmpDb;
		migrator.createTable(config);
		tmpDb.close();
		return;
	}
	targetNumber = targetNumber + ''; // ensure that it's a string

	// Create the migration tracking table if it doesn't already exist.
	// Get the current saved migration number.
	var currentNumber = GetMigrationFor(config.adapter.db_name, config.adapter.collection_name);

	// If the current and requested migrations match, the data structures
	// match and there is no need to run the migrations.
	var direction;
	if (currentNumber === targetNumber) {
		return;
	} else if (currentNumber && currentNumber > targetNumber) {
		direction = 0; // rollback
		migrations.reverse();
	} else {
		direction = 1;  // upgrade
	}

	// open db for our migration transaction
	db = Ti.Database.open(config.adapter.db_name);
	migrator.db = db;
	db.execute('BEGIN;');

	// iterate through all migrations based on the current and requested state,
	// applying all appropriate migrations, in order, to the database.
	if (migrations.length) {
		for (var i = 0; i < migrations.length; i++) {
			// create the migration context
			var migration = migrations[i];
			var context = {};
			migration(context);

			// if upgrading, skip migrations higher than the target
			// if rolling back, skip migrations lower than the target
			if (direction) {
				if (context.id > targetNumber) { break; }
				if (context.id <= currentNumber) { continue; }
			} else {
				if (context.id <= targetNumber) { break; }
				if (context.id > currentNumber) { continue; }
			}

			// execute the appropriate migration function
			var funcName = direction ? 'up' : 'down';
			if (_.isFunction(context[funcName])) {
				context[funcName](migrator);
			}
		}
	} else {
		migrator.createTable(config);
	}

	// update the saved migration in the db
	db.execute('DELETE FROM migrations where model = ?', config.adapter.collection_name);
	db.execute('INSERT INTO migrations VALUES (?,?)', targetNumber, config.adapter.collection_name);

	// end the migration transaction
	db.execute('COMMIT;');
	db.close();
	migrator.db = null;
}

function installDatabase(config) {
	// get the database name from the db file path
	var dbFile = config.adapter.db_file;
	var table = config.adapter.collection_name;
	var rx = /(^|.*\/)([^\/]+)\.[^\/]+$/;
	var match = dbFile.match(rx);
	if (match === null) {
		throw 'Invalid sql database filename "' + dbFile + '"';
	}
	//var isAbsolute = match[1] ? true : false;
	config.adapter.db_name = config.adapter.db_name || match[2];
	var dbName = config.adapter.db_name;

	// install and open the preloaded db
	Ti.API.debug('Installing sql database "' + dbFile + '" with name "' + dbName + '"');
	var db = Ti.Database.install(dbFile, dbName);

	// set remoteBackup status for iOS
	if (config.adapter.remoteBackup === false && OS_IOS) {
		Ti.API.debug('iCloud "do not backup" flag set for database "'+ dbFile + '"');
		db.file.setRemoteBackup(false);
	}

	// compose config.columns from table definition in database
	var rs = db.execute('pragma table_info("' + table + '");');
	var columns = {};
	while (rs.isValidRow()) {
		var cName = rs.fieldByName('name');
		var cType = rs.fieldByName('type');
		columns[cName] = cType;

		// see if it already has the ALLOY_ID_DEFAULT
		if (cName === ALLOY_ID_DEFAULT && !config.adapter.idAttribute) {
			config.adapter.idAttribute = ALLOY_ID_DEFAULT;
		}

		rs.next();
	}
	config.columns = columns;
	rs.close();

	// make sure we have a unique id field
	if (config.adapter.idAttribute) {
		if (!_.contains(_.keys(config.columns), config.adapter.idAttribute)) {
			throw 'config.adapter.idAttribute "' + config.adapter.idAttribute + '" not found in list of columns for table "' + table + '"\n' + 'columns: [' + _.keys(config.columns).join(',') + ']';
		}
	} else {
		Ti.API.info('No config.adapter.idAttribute specified for table "' + table + '"');
		Ti.API.info('Adding "' + ALLOY_ID_DEFAULT + '" to uniquely identify rows');

		var fullStrings = [],
		colStrings = [];
		_.each(config.columns, function(type, name) {
			colStrings.push(name);
			fullStrings.push(name + ' ' + type);
		});
		var colsString = colStrings.join(',');
		db.execute('ALTER TABLE ' + table + ' RENAME TO ' + table + '_temp;');
		db.execute('CREATE TABLE ' + table + '(' + fullStrings.join(',') + ',' + ALLOY_ID_DEFAULT + ' TEXT UNIQUE);');
		db.execute('INSERT INTO ' + table + '(' + colsString + ',' + ALLOY_ID_DEFAULT + ') SELECT ' + colsString + ',CAST(_ROWID_ AS TEXT) FROM ' + table + '_temp;');
		db.execute('DROP TABLE ' + table + '_temp;');
		
		config.columns[ALLOY_ID_DEFAULT] = 'TEXT UNIQUE';
		config.adapter.idAttribute = ALLOY_ID_DEFAULT;
	}

	// close the db handle
	db.close();
}

module.exports.beforeModelCreate = function(config, name) {
	// use cached config if it exists
	if (cache.config[name]) {
		return cache.config[name];
	}

	// check platform compatibility
	if (Ti.Platform.osname === 'mobileweb' || typeof Ti.Database === 'undefined') {
		throw 'No support for Titanium.Database in MobileWeb environment.';
	}

	// install database file, if specified
	if (config.adapter.db_file) { installDatabase(config); }
	if (!config.adapter.idAttribute) {
		Ti.API.info('No config.adapter.idAttribute specified for table "' + config.adapter.collection_name + '"');
		Ti.API.info('Adding "' + ALLOY_ID_DEFAULT + '" to uniquely identify rows');
		config.columns[ALLOY_ID_DEFAULT] = 'TEXT UNIQUE';
		config.adapter.idAttribute = ALLOY_ID_DEFAULT;
	}

	// add this config to the cache
	cache.config[name] = config;

	return config;
};

module.exports.afterModelCreate = function(Model, name) {
	// use cached Model class if it exists
	if (cache.Model[name]) {
		return cache.Model[name];
	}

	// create and migrate the Model class
	Model = Model || {};
	Model.prototype.idAttribute = Model.prototype.config.adapter.idAttribute;
	Migrate(Model);

	// Add the Model class to the cache
	cache.Model[name] = Model;

	return Model;
};

module.exports.sync = Sync;
