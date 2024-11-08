/** A Reactor controller for LG TVs.
 *  Copyright (c) 2022/2023 Daniele Bochicchio, All Rights Reserved.
 *  LGTVController is offered under MIT License - https://mit-license.org/
 *  More info: https://github.com/dbochicchio/reactor-lgtv
 *
 *  Disclaimer: This is beta software, so quirks and bugs are expected. Please report back.
 */

const version = 25313;
const className = "lgtv";
const ns = "x_lgtv"
const ignoredValue = "@@IGNORED@@"

const Controller = require("server/lib/Controller");
const Capabilities = require("server/lib/Capabilities");

const LGTV = require('lgtv2');

const Logger = require("server/lib/Logger");
Logger.getLogger('LGTVController', 'Controller').always("Module LGTVController v%1", version);

const util = require("server/lib/util");

const TimerBroker = require("server/lib/TimerBroker");

const debounce = (callback, wait) => {
	let timeoutId = null;
	return (...args) => {
		clearTimeout(timeoutId);
		timeoutId = setTimeout(() => {
			callback.apply(null, args);
		}, wait);
	};
}

var impl = false;  /* Implementation data, one copy for all instances, will be loaded by start() later */

module.exports = class LGTVController extends Controller {
	constructor(struct, id, config) {
		super(struct, id, config);  /* required *this.*/

		this.failures = 0;

		this.lgtv = undefined;

		this.stopping = false;      /* Flag indicates we're stopping */
		this.connected = false;

		// we do not need the group, since it's a one man band show here
		this.removeControllerGroup();
	}

	/** Start the controller. */
	async start() {
		if (!this.config.host) {
			this.log.err("%1 No host configured", this);
			return Promise.reject("No host configured");
		}

		/** Load implementation data if not yet loaded. Remove this if you don't
		 *  use implementation data files.
		 */
		if (false === impl) {
			impl = await this.loadBaseImplementationData(className, __dirname);
		}

		this.log.debug(5, "%1 starting", this);

		this.stopping = false;
		this.run();

		return this;
	}

	/* Stop the controller. */
	async stop() {
		this.log.debug(5, "%1 stopping", this);
		this.stopping = true;

		/* Required ending */
		return await super.stop();
	}

	/* run() is called when Controller's single-simple timer expires. */
	run() {
		this.log.debug(5, "%1 running", this);

		this.startClient();
	}

	/* startClient() load status and creates the entities */
	startClient() {
		if (this.stopping) return;

		const e = this.system;
		var that = this;
		var log = this.log;

		log.debug(5, "%1 [refreshStatus] - startClient: %2", that, that.config.host);
		this.mapSystemDevice(that, false);
		that.online();

		this.lgtv = new LGTV({
			url: (that.config.secure ?? true) ? `wss://${that.config.host}:3001` : `ws://${that.config.host}:3000`,
			timeout: that.config.timeout || 15000,
			keyFile: `${__dirname}/client.key`, // TODO: path from config/code

			wsconfig: {
				keepalive: true,
				keepaliveInterval: 10000,
				dropConnectionOnKeepaliveTimeout: false,
				keepaliveGracePeriod: 5000,
				tlsOptions: {
					rejectUnauthorized: false
				}
			}
		});

		this.lgtv.on('error', function (err) {
			if (err.code === 'EHOSTUNREACH' || err.code === 'ETIMEDOUT') {
				log.notice("%1 Soft error: %2", that, err.code);
			}
			else
				that.onError(that, err);

			// update connection status
			that.connected = false;
			that.updateConnection(e, that.connected);
		});

		this.lgtv.on('connecting', function () {
			log.debug(5, "%1 Connecting to %2", that, that.config.host);
			// update connection status
			that.connected = false;
			that.updateConnection(e, that.connected);
		});

		this.lgtv.on('connect', function () {
			that.online();

			log.notice("%1 Connected: %2", that, that.config.host);

			// update connection status
			that.connected = true;
			that.updateConnection(e, that.connected);

			that.lgtv.subscribe('ssap://audio/getVolume', function (err, res) {
				log.debug(5, "%1 getVolume: %2 - %3", that, that.config.host, res);
				var attributes = {};

				if (res.volumeStatus?.volume !== undefined) attributes["volume.level"] = res.volumeStatus.volume / 100;
				if (res.volumeStatus?.muteStatus !== undefined) attributes["muting.state"] = res.volumeStatus.muteStatus;
				if (res.volumeStatus?.soundOutput !== undefined) attributes["_ns_.output"] = res.volumeStatus.soundOutput;

				if (res.changed !== undefined && res.changed.indexOf('volume') !== -1) attributes["volume.level"] = res.volume / 100;
				if (res.changed !== undefined && res.changed.indexOf('muted') !== -1) attributes["muting.state"] = res.muted;

				// update attributes with debounce
				debounce(function () {
					log.debug(5, "%1 debounce: %2", that, attributes);
					that.updateEntityAttributes(e, attributes);
				}, 2000)();
			});

			var liveTVReady = false;
			that.lgtv.subscribe('ssap://com.webos.applicationManager/getForegroundAppInfo', function (err, res) {
				log.debug(5, "%1 getForegroundAppInfo: %2 - %3", that, that.config.host, res);

				// update attributes
				that.updateEntityAttributes(e, { "_ns_.input": res.appId });

				// live TV support
				if (res.appId === 'com.webos.app.livetv') {
					if (!liveTVReady) {
						liveTVReady = true;
						setTimeout(() => {
							that.lgtv.subscribe('ssap://tv/getCurrentChannel', (err, res) => {
								log.debug(5, "%1 getCurrentChannel: %2 - %3", that, that.config.host, res);
								if (err) {
									that.onError(that, err);
									return;
								}

								var attributes = {};
								attributes["_ns_.channel_id"] = res.channelNumber;
								that.updateEntityAttributes(e, attributes);
							});
						}, 3000);
					}
				}
			});
		});

		this.lgtv.on('prompt', function () {
			log.warn("%1 prompt: %2", that, that.config.host);
			that.sendWarning("LG TV needs your authorization to run: check your TV and approve the request");
		});

		this.lgtv.on('close', function () {
			log.debug(5, "%1 Connection closed: %2", that, that.config.host);

			// update connection status
			that.connected = false;
			that.updateConnection(e, that.connected);

			log.debug(5, "%1 Connection closed", that);
		});

	}

	/* mapSystemDevice() is used to create the system device */
	mapSystemDevice(that, state) {
		that.mapDevice("system", that.config.name ?? "LG TV",
			["volume", "muting", "power_switch", "toggle", "sys_system", ns], "power_switch.state",
			{
				"power_switch.state": state,
				"toggle.state": state,
				"_ns_.online": state,
			});
	}

	/* updateConnection() is used to update the connection status */
	updateConnection(e, state) {
		var attributes = {
			"power_switch.state": state,
			"toggle.state": state,
			"_ns_.online": state,
		};

		// update attributes
		this.updateEntityAttributes(e, attributes);
	}

	/* offline() is used to handle the offline status */
	onError(that, err) {
		console.log(err);
		that.log.err("%1 Error: %2", that, err);

		try {
			that.startDelay(Math.min(120_000, (that.config.error_interval || 5_000) * Math.max(1, ++that.failures - 12)));
		}
		catch {
			// soft warning
		}

		if (that.failures >= 3) {
			that.offline();
		}
	}

	/* performOnEntity() is used to implement actions on entities */
	async performOnEntity(e, actionName, params) {
		this.log.debug(5, "%1 [performOnEntity] %3 - %2 - %4", this, actionName, e, params);

		if (!this.connected && !actionName.startsWith('sys_system')) {
			this.log.warn("%1 LG TV %2 is offline - can't execute: %3", this, this.config.host, actionName);
			return;
		}

		switch (actionName) {
			case `${ns}.sendnotification`:
			case `${ns}.send_notification`:
				if (params?.text == undefined) {
					this.log.warn("%1 LG TV %2- text param is mandatory and must be specified", this, this.config.host);
				}
				else {
					this.lgtv?.send("request", "ssap://system.notifications/createToast", {
						message: params.text
					});
				}
				return;
			case 'power_switch.on':
				this.lgtv?.request("ssap://system/turnOn");
				return;
			case 'power_switch.off':
				this.lgtv?.request("ssap://system/turnOff");
				return;
			case 'toggle.toggle':
				var state = e.getAttribute('power_switch.state') === true;
				this.performOnEntity(e, state ? 'power_switch.off' : 'power_switch.on');
				return;

			case 'volume.increase':
				var currentVolume = e.getAttribute("volume.level") ?? -1;
				if (currentVolume == -1) {
					this.lgtv?.request("ssap://audio/volumeUp");
				}
				else {
					var volume = ((params?.amount || 0) + currentVolume) * 100;
					this.lgtv?.request("ssap://audio/setVolume", { volume: parseInt(volume, 10) } || 0);
				}
				return;
			case 'volume.decrease':
				var currentVolume = e.getAttribute("volume.level") ?? -1;
				if (currentVolume == -1) {
					this.lgtv?.request("ssap://audio/volumeDown");
				}
				else {
					var volume = ((params?.amount || 0) - currentVolume) * 100;
					this.lgtv?.request("ssap://audio/setVolume", { volume: parseInt(volume, 10) } || 0);
				}
				return;
			case 'volume.relative':
				var volume = (params?.amount || 0) * 100;

				this.lgtv?.request("ssap://audio/setVolume", { volume: parseInt(volume, 10) } || 0);
				return;

			case 'volume.setdb':
			case 'volume.set':
				var volume = (params?.value || params?.db || 0) * 100;
				this.lgtv?.request("ssap://audio/setVolume", { volume: parseInt(volume, 10) } || 0);
				return;

			case 'muting.mute':
			case 'muting.unmute':
			case 'muting.toggle':
			case 'muting.set':
				var payload = params?.muting === 'true' || actionName == 'muting.mute';

				// TODO: special case for toggle
				this.lgtv?.request('ssap://audio/setMute', { mute: payload });
				return;

			case 'sys_system.restart':
				this.lgtv = undefined;
				this.stopping = false;
				this.startClient();
				return;
		}

		return super.performOnEntity(e, actionName, params);
	}

	/* Maps a device into a MSR entity */
	mapDevice(id, name, capabilities, defaultAttribute, attributes) {
		this.log.debug(5, "%1 mapDevice(%2, %3, %4, %5, %6)", this, id, name, capabilities, defaultAttribute, attributes);

		var isNew = false;
		let e = this.findEntity(id);

		try {
			if (!e) {
				this.log.notice("%1 Creating new entity for %2", this, name);
				e = this.getEntity(className, id);
				e.setName(name);
				e.setType(className);
				isNew = true;
			}

			e.deferNotifies(true);
			e.markDead(false);

			// capabilities
			if (capabilities) {
				this.log.debug(5, "%1 [%2] adding capabilities: %3", this, id, capabilities);
				e.extendCapabilities(capabilities);

				// Check controller and system capabilities versions for changes
				const vinfo = { ...Capabilities.getSysInfo(), controller: version };
				const hash = util.hash(JSON.stringify(vinfo));
				if (e._hash !== hash) {
					e.refreshCapabilities();
					e._hash = hash;
				}
			}

			this.updateEntityAttributes(e, attributes);

			if (defaultAttribute)
				e.setPrimaryAttribute(defaultAttribute);

			if (isNew)
				this.sendNotice('Discovered new device {0:q} ({1}) on controller {2:q}', name, id, this);
		} catch (err) {
			this.log.err("%1 [mapDevice] error: %2", this, err);
		} finally {
			e.deferNotifies(false);
		}
	}

	updateEntityAttributes(e, attributes) {
		if (e && attributes) {
			e.deferNotifies(true);
			e.markDead(false);

			for (const attr in attributes) {
				var newValue = attributes[attr];

				// skip ignored values
				if (ignoredValue != newValue) {
					// check if value has changed
					var attrName = attr.replace(/_ns_/g, ns);
					var value = e.getAttribute(attrName);

					// check for and skip unchanged values
					var changed = value != newValue && JSON.stringify(value) != JSON.stringify(newValue);
					if (changed) {
						var id = e.getCanonicalID();
						this.log.debug(5, "%1 [%2] %3: %4 => %5", this, id, attrName, newValue, value);
						e.setAttribute(attrName, newValue);
					}
				}
			}

			e.deferNotifies(false);
		}
	}
};