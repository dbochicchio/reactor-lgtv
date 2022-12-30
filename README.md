# reactor-lgtv
LGTV Controller for Reactor - Multi-Hub Automation.

## Installation
LGTV Controller must be installed separately. Just download all the files from this repo.

Create, if it does not already exist, a directory called *ext* in your Reactor install directory (so it should be at the same level as config, storage, etc.).

```
cd /path/to/reactor
mkdir ext
```

If you are running Reactor in a docker container, the *ext* directory should be created in the data directory, where your config and storage directories live as indicated above.

Change directory into the new *ext* directory:

```
cd ext
mkdir LGTVController
```

Copy all the files in the new directory named *LGTVController*.
Your final path should be */path/to/reactor/ext/LGTVController*.

Run the install script. If you are using a "bare metal" install (not a docker container):

```
cd LGTVController
./install.sh
```

If you are running Reactor in a docker container, we will open a container shell in which to do the install (the Reactor container must be up and running):

```
docker exec -it <container-name> /bin/sh
cd /var/reactor/ext/LGTVController
./install.sh
exit
```

From here, proceed to Basic Configuration below.

## Basic Configuration

In order to use LGTV Controller, you have to add an entry for it to the controllers section of your *reactor.yaml* file.

```
controllers:
  # Your existing controllers will be below the above line.
  # Add the following after the last "- id" line in this
  # section.
  - id: lgtvcontroller
    name: LG TV
    implementation: LGTVController
    enabled: true
    config:
      # Replace the IP with that of your OpenSprinkler host below.
      host: "192.168.1.41"

      # interval for refresh: default 5 secs
      #interval: 5000

      # timeout: default 15 secs
      #timeout: 15000

      # error_interval: default 10 secs
      #error_interval: 10000
```

Restart Reactor to make the changes take effect. After that, you should be able to refresh the UI, go the Entities list, clear any existing filters, and choose "LG TV" from the controllers filter selector. That should then show you one entity represening the TV. If you don't see this, check the log for errors.
If you have multiple TVs, just repeat the registration, changing the *id* attribute in your registraion (that must be unique).

## Capabilities

 - Set/Get volume (via standard *volume* capability)
 - Set/Get mute (via standard *muting* capability)
 - Turn on/off TV  (via standard *power_switch* capability)
 - Get current HDMI and audio output (see *x_lgtv.input* and *x_lgtv.output*)
 - Send toast notification, via *x_lgtv.sendnotification* action
 
 Both *power_switch.state* and *x_lgtv.online* will be *false* when TV is off.
 *x_lgtv.online* is true when TV network is reachable.

 
## Support

This is beta software, so expect quirks and bugs. Support is provided via https://smarthome.community/.