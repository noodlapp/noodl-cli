#!/usr/bin/env node
const s3 = require('s3');
const AWS = require('aws-sdk');
const fs = require('fs');
var fse = require('fs-extra');
const request = require('request');
const archiver = require('archiver');
const md5File = require('md5-file');

function guid() {
    function s4() {
        return Math.floor((1 + Math.random()) * 0x10000)
            .toString(16)
            .substring(1);
    }
    return s4() + s4() + '-' + s4() + '-' + s4() + '-' +
        s4() + '-' + s4() + s4() + s4();
}

function uploadFiles(opts) {
    // Copy files to a temporary dir
    var tmpdir = require('os').tmpdir() + '/' + guid();
    fs.mkdirSync(tmpdir);
    opts.files.forEach((f) => {
        fs.copyFileSync((opts.path ? opts.path : '') + f, tmpdir + '/' + f);
    })

    // Upload tmp dir
    function reportProgress(amount, total) {
        process.stdout.write((total > 0 ? Math.round(amount / total * 100) : 0) + '%\r');
    }
    return new Promise(function (resolve, reject) {
        var client = s3.createClient({
            maxAsyncS3: 20,     // this is the default 
            s3RetryCount: 3,    // this is the default 
            s3RetryDelay: 1000, // this is the default 
            multipartUploadThreshold: 20971520, // this is the default (20 MB) 
            multipartUploadSize: 15728640, // this is the default (15 MB) 
            s3Options: {
                accessKeyId: keys.accessKeyId,
                secretAccessKey: keys.secretAccessKey,
                sessionToken: keys.sessionToken,
                // any other options are passed to new AWS.S3() 
                // See: http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/Config.html#constructor-property 
            },
        });
        var params = {
            localDir: tmpdir,
            deleteRemoved: false, // default false, whether to remove s3 objects 
            // that have no corresponding local file. 

            s3Params: {
                Bucket: opts.bucket,
                Prefix: opts.prefix,
                // other options supported by putObject, except Body and ContentLength. 
                // See: http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#putObject-property 
            },
        };
        var uploader = client.uploadDir(params);
        uploader.on('error', function (err) {
            fse.removeSync(tmpdir);
            reject(new Error("Unable to upload dir " + dir));
        });
        uploader.on('progress', function () {
            reportProgress(uploader.progressAmount, uploader.progressTotal);
        });
        uploader.on('end', function () {
            fse.removeSync(tmpdir);
            resolve();
        });
    })
}

var keys,domain;

function getDomainInfo(domain) {
    return new Promise(function (resolve, reject) {
        request({
            method: 'GET',
            url: 'http://domains.noodlcloud.com/' + domain + '.json'
        }, function (error, response, body) {
            if (error || response.statusCode !== 200) reject(error || Error('Could not get domain.'))
            else resolve(JSON.parse(response.body))
        })
    })
}

function getWorkspaceCredentials(name, domain, key) {
    return new Promise(function (resolve, reject) {
        request({
            method: 'GET',
            url: domain.authEndpoint + '/workspace/' + encodeURIComponent(name) + '/credentials',
            headers: {
                'Authorization': key
            }
        }, function (error, response, body) {
            if (error || response.statusCode !== 200) reject(error || Error('Could not get workspace credentials.'))
            else resolve(JSON.parse(response.body))
        })
    })
}

function zipFolderContentWithHash(options) {
    var zipTarget = options.cwd + '/' + options.folder + '.zip';
    var output = fs.createWriteStream(zipTarget);
    var archive = archiver('zip', {
        zlib: { level: 9 } // Sets the compression level.
    });

    function _readDirRec(dir,_res) {
        var res = _res || [];

        var files = fs.readdirSync(dir);
        files.forEach((f) => {
            var stats = fs.statSync(dir + '/' + f);
            if(stats && stats.isDirectory()) {
                _readDirRec(dir + '/' + f,res)
            }
            else {
                res.push(dir + '/' + f);
            }
        })

        return res;
    }

    return new Promise(function (resolve, reject) {
        var folderPath = options.cwd + '/' + options.folder;
        var files = _readDirRec(folderPath);
        var f = files.pop();
        archive.file(f,{name:f.substring(folderPath.length+1)});

        // good practice to catch warnings (ie stat failures and other non-blocking errors)
        archive.on('warning', function (err) {
            console.log(err);
        });

        // good practice to catch this error explicitly
        archive.on('error', function (err) {
            reject(err);
        });

        archive.on('entry', function (arg) {
            //console.log(arg.name,arg.sourcePath);
            if(files.length > 0) {
                var f = files.pop();
                archive.file(f,{name:f.substring(folderPath.length+1)});
            }
            else {
                archive.finalize();
            }
        })

        output.on('close', function () {
            const hash = md5File.sync(zipTarget);
            var zipWithHashTarget = options.cwd + '/' + (options.target || options.folder) + '-' + hash + '.zip';
            fs.renameSync(zipTarget, zipWithHashTarget);

            //console.log(zipTarget,zipWithHashTarget,hash);

            resolve((options.target || options.folder) + '-' + hash + '.zip');
        })

        // pipe archive data to the file
        archive.pipe(output);

       
    })

}


function putJSONObject(options) {
    var s3 = new AWS.S3({
        accessKeyId: keys.accessKeyId,
        secretAccessKey: keys.secretAccessKey,
        sessionToken: keys.sessionToken
    });
    var params = {
        Body: JSON.stringify(options.json),
        Bucket: options.bucket,
        Key: options.key,
    };

    return new Promise(function (resolve, reject) {
        s3.putObject(params, function (err, data) {
            if (err) { reject(err) }
            else resolve({ json: options.json })
        });
    })
}

function getJSONObject(options, fn) {
    const s3 = new AWS.S3({
        accessKeyId: keys.accessKeyId,
        secretAccessKey: keys.secretAccessKey,
        sessionToken: keys.sessionToken
    });

    var getParams = {
        Bucket: options.bucket,
        Key: options.key
    }

    return new Promise(function (resolve, reject) {
        s3.getObject(getParams, function (err, data) {
            if (err) return reject(err);

            try {
                var objectData = data.Body.toString('utf-8'); // Use the encoding necessary
                var o = JSON.parse(objectData);
            }
            catch (e) {
                reject(Error('Could not parse JSON.'));
                return;
            }

            resolve(o);
        });
    })

}

async function putConfig(userConfig) {
    // Write user config
    try {
        await putJSONObject({ bucket: keys.bucket, key: keys.prefix + 'config.json', json: { config: userConfig } });
    }
    catch (e) {
        console.log('Could not write workspace config.');
        return;
    }
}

function updateTemplateFile(path,args) {
    var fileContent = fs.readFileSync(path,'utf8');
    if(args.name) fileContent = fileContent.replace(/\{\{name\}\}/g, args.name);
    if(args.id) fileContent = fileContent.replace(/\{\{id\}\}/g, args.id);  
    fs.writeFileSync(path,fileContent);
}

function CreateReactLib(args) {
    const dir = argv._[1];
    if(!dir) return console.log('Must specify target directory name')

    if(fs.existsSync(dir)) return console.log(`Directory ${dir} already exists.`)

    try {
        fs.mkdirSync(dir);

        const template = __dirname + '/templates/create-react-lib/.';
        fse.copySync(template,dir);
    }
    catch(e) {
        console.log('Failed to initialize from template',e);
    }

    if(!args.name) args.name = dir.replace(/\s+/g, '-').toLowerCase();
    args.id = guid() + '-' + args.name;

    updateTemplateFile(dir + '/module/package.json',args);
    updateTemplateFile(dir + '/module.json',args);

    console.log('Success');
}

function CreateLib(args) {
    const dir = argv._[1];
    if(!dir) return console.log('Must specify target directory name')

    if(fs.existsSync(dir)) return console.log(`Directory ${dir} already exists.`)

    try {
        fs.mkdirSync(dir);

        const template = __dirname + '/templates/create-lib/.';
        fse.copySync(template,dir);
    }
    catch(e) {
        console.log('Failed to initialize from template',e);
    }

    if(!args.name) args.name = dir.replace(/\s+/g, '-').toLowerCase();
    args.id = guid() + '-' + args.name;

    updateTemplateFile(dir + '/module/package.json',args);
    updateTemplateFile(dir + '/module.json',args);

    console.log('Success');
}

function UpdateDesc(args) {
    if(!fs.existsSync('./module.json')) return console.log('Must be in library module directory.');

    try {
        module = JSON.parse(fs.readFileSync('module.json'));
    }
    catch (e) {
        console.log('Could not read module config file.');
        return;
    }

    module.label = args.label || module.label;
    module.desc = args.desc || module.desc;
    module.docs = args.docs || module.docs;

    fs.writeFileSync('module.json',JSON.stringify(module,null,2));

    console.log('Success');
}

async function UploadLib(args) {
    if(!args.workspace) return console.log('Must provide workspace name with --workspace "workspace-name". ')

    if(!args.accessKey) return console.log('Must provide workspace access key with --accessKey "XYZ". ')

    try {
        domain = await getDomainInfo(args.workspace);

        keys = await getWorkspaceCredentials(args.workspace, domain, args.accessKey);
    }
    catch (e) {
        console.log('Could not get workspace (' + args.workspace + ') credentials, is the access key correct?');
        return;
    }

    try {
        module = JSON.parse(fs.readFileSync('module.json'));
    }
    catch (e) {
        console.log('Could not read module config file.');
        return;
    }

    const archive = await zipFolderContentWithHash({ cwd: '.', target: module.name, folder: 'project' })
    fs.copyFileSync('icon.png',module.name + '-icon.png');

    const files = [archive,module.name + '-icon.png'];
    await uploadFiles({
        files: files,
        path: './',
        bucket: keys.bucket,
        prefix: keys.prefix + 'library',
    })

    files.forEach((f) => fs.unlinkSync('./' + f))

    try {
        var userConfig = await getJSONObject({ bucket: keys.bucket, key: keys.prefix + 'config.json' });
        userConfig = userConfig.config;
    }
    catch (e) {
        console.log('Could not retrieve config from workspace.');
        console.log(e);
        return;
    }

    if(!userConfig.library) userConfig.library = [];
    var lib = userConfig.library.find((l) => l._id === module._id)
    if(!lib) {
        lib = {_id:module._id}
        userConfig.library.push(lib);
    }

    lib.label = module.label;
    lib.desc = module.desc;
    lib.url = domain.resourcesEndpoint + '/' + keys.prefix + 'library/' + archive;
    lib.thumbURL = domain.resourcesEndpoint + '/' + keys.prefix + 'library/' + module.name + '-icon.png';
    lib.docs = module.docs;

    await putConfig(userConfig);

    console.log('Success');
}

async function RemoveLib(args) {
    if(!args.workspace) return console.log('Must provide workspace name with --workspace "workspace-name". ')

    if(!args.accessKey) return console.log('Must provide workspace access key with --accessKey "XYZ". ')

    try {
        domain = await getDomainInfo(args.workspace);

        keys = await getWorkspaceCredentials(args.workspace, domain, args.accessKey);
    }
    catch (e) {
        console.log('Could not get workspace (' + args.workspace + ') credentials, is the access key correct?');
        return;
    }

    try {
        module = JSON.parse(fs.readFileSync('module.json'));
    }
    catch (e) {
        console.log('Could not read module config file.');
        return;
    }

    try {
        var userConfig = await getJSONObject({ bucket: keys.bucket, key: keys.prefix + 'config.json' });
        userConfig = userConfig.config;
    }
    catch (e) {
        console.log('Could not retrieve config from workspace.');
        console.log(e);
        return;
    }

    if(userConfig.library === undefined) {
        console.log('Workspace has no library.');
        return;
    }

    var libIdx = userConfig.library.findIndex((l) => l._id === module._id)
    if(libIdx === -1) {
        console.log('Module is not part of this workspace library.')
        return;
    }

    userConfig.library.splice(libIdx,1);

    await putConfig(userConfig);

    console.log('Success');
}

const commands = {
    'create-react-lib':CreateReactLib,
    'create-lib':CreateLib,
    'push':UploadLib,
    'desc':UpdateDesc,
    'remove':RemoveLib
}

var argv = require('minimist')(process.argv.slice(2))
const cmd = argv._[0];
if(!commands[cmd]) {
    console.log('Unknown command');
}
else commands[cmd](argv);