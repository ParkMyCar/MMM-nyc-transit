/* Magic Mirror
 * Module: MMM-NYC-transit
 *
 * By Elan Trybuch https://github.com/elaniobro
 * MIT Licensed.
 */

Module.register('MMM-nyc-transit', { /*eslint-disable-line*/
  // Default module config.
  defaults: {
    displayType: 'list',
    header: 'Next Train',
    module: 'MMM-nyc-transit',
    mtaType: 'train',
    position: 'top_bar',
    stations: [
      {
        dir: {
          upTown: true,
          downTown: true,
        },
        stationId: 237,
        walkingTime: 5,
        ignore: [],
      },
      {
        dir: {
          upTown: true,
          downTown: true,
        },
        stationId: 238,
        walkingTime: 5,
        ignore: [],
      },
    ],
    updateInterval: 300000, // every 5 min
  },

  getStyles: function () {
    return ['MMM-nyc-transit.css']
  },

  start: function () {
    this.getDepartures()
    this.scheduleUpdate()
  },

  getDom: function () {
    // Set up targetnode based on position set in config
    var targetNode = document.querySelector('.region.' + this.config.position.split('_').join('.') + ' .container')
    // set up mutation observer config options
    var config = { attributes: true, childList: true, subtree: true }
    // call back function for mutation observer
    var callback = function (mutationsList, observer) { /*eslint-disable-line*/
      // Use traditional 'for loops' for IE 11
      for (var mutation of mutationsList) {
        if (mutation.type === 'childList') {
          var trainTimes = document.querySelectorAll('.mta__train--time span')

          trainTimes.forEach((train) => {
            // Get the train time as a Number type
            var duration = Number(train.textContent.split('min')[0])
            var timer = duration * 60
            var minutes
            var seconds

            // Compare duration to walkingtime
            if (duration <= Number(train.dataset.walkingTime)) {
              setInterval(function () {
                minutes = parseInt(timer / 60, 10)
                seconds = parseInt(timer % 60, 10)

                // minutes = minutes < 10 ? minutes : minutes;
                seconds = seconds < 10 ? '0' + seconds : seconds
                train.textContent = minutes + ':' + seconds + 'min'

                if (--timer < 0) {
                  timer = duration
                }
              }, 1000)
            }
          })
        }
      }
    }

    var observer = new MutationObserver(callback)

    /** @type {StationData[] | null} */
    var data = this.result // the data is not ready

    /** @type {BusData | null} */
    const busData = this.busResults;

    var wrapper = document.createElement('div')
    wrapper.className = 'MMM-nyc-transit'

    if (!data && !busData) {
      // observer mutation on targetNode with config obj
      observer.observe(targetNode, config)

      return wrapper
    }

    if (data) {
      for (const stationData of data) {
        // If we don't have any arrival info for a station, don't bother rendering it.
        if (arrayIsEmpty(stationData.upTownArrivals) && arrayIsEmpty(stationData.downTownArrivals)) {
          continue;
        }

        // Add a header which contains the name of the station and each line it serves
        const header = this.generateStationHeader(stationData.complexId);
        wrapper.appendChild(header);

        var upTownList = document.createElement('ul')
        upTownList.className = 'mta__train--list'

        var downTownList = document.createElement('ul')
        downTownList.className = 'mta__train--list'

        var downTown = stationData.downTownArrivals;
        var upTown = stationData.upTownArrivals;

        if (data.length === 0) {
          return wrapper
        }

        // collect and map arrival times based on trains
        var trainHashMap = {
          downTown: [],
          upTown: [],
        }

        // Downtown trains
        downTown.forEach((train) => {
          if (!trainHashMap.downTown[this.isSIR(train.routeId)]) {
            trainHashMap.downTown[this.isSIR(train.routeId)] = {
              time: [train.minutes],
              dest: train.destination,
              walkingTime: 0,
            }
          } else {
            trainHashMap.downTown[
              this.isSIR(train.routeId)
            ].time.push(train.minutes)
          }
        })

        for (var dKey in trainHashMap.downTown) {
          const dest = trainHashMap.downTown[dKey].dest;
          const times = trainHashMap.downTown[dKey].time;

          const item = this.generateTrainLine(dKey, dest, times);
          downTownList.appendChild(item);
        }

        // Uptown trains
        upTown.forEach((train) => {
          if (!trainHashMap.upTown[this.isSIR(train.routeId)]) {
            trainHashMap.upTown[this.isSIR(train.routeId)] = {
              time: [train.minutes],
              dest: train.destination,
              walkingTime: 0,
            }
          } else {
            trainHashMap.upTown[
              this.isSIR(train.routeId)
            ].time.push(train.minutes)
          }
        })

        for (var uKey in trainHashMap.upTown) {
          const dest = trainHashMap.upTown[uKey].dest;
          const times = trainHashMap.upTown[uKey].time;

          const item = this.generateTrainLine(uKey, dest, times);
          upTownList.appendChild(item);
        }

        // Finally, create a header for each uptown and downtown, and add it to the DOM

        if (upTown.length > 0) {
          const upTownHeader = this.generateTrainListHeader("Uptown");
          wrapper.appendChild(upTownHeader)
          wrapper.appendChild(upTownList)
        }

        if (downTown.length > 0) {
          const downTownHeader = this.generateTrainListHeader("Downtown");
          wrapper.appendChild(downTownHeader)
          wrapper.appendChild(downTownList)
        }
      }
    }

    if (busData) {
      for (const busStop of busData.stops) {
        if (busStop.arrivals.length > 0) {
          const header = this.generateBusStopHeader(busStop.stopId);
          wrapper.appendChild(header);

          const KEY_DELIMITER = '::_::';
          
          /** @type {Map<string, {minutes: number, isPredicted: boolean}[]>} */
          var arrivalsMap = new Map();
          for (const arrival of busStop.arrivals) {

            const key = arrival.name + KEY_DELIMITER + arrival.overallDestination;
            if (!arrivalsMap.get(key)) {
              arrivalsMap.set(key, []);
            }

            arrivalsMap.get(key).push({
              minutes: arrival.minutes, 
              isPredicted: arrival.isPredicted
            });
          }
          
          var busList = document.createElement('ul')
          busList.className = 'mta__bus--list'

          for (const busKey of arrivalsMap.keys()) {
            const arrivals = arrivalsMap.get(busKey)
              .filter((arrival) => arrival.minutes > 0)
              .slice(0, 3);
            const parts = busKey.split(KEY_DELIMITER);

            const name = parts[0];
            const dest = parts[1];

            const busArrivals = this.generateBusArrival(name, dest, arrivals);
            busList.appendChild(busArrivals);
          }

          wrapper.appendChild(busList);
        }
      }
    }

    return wrapper;
  },

  /**
   * Generate an HTML Line Item for a single train line, e.g.
   * 
   * (6) Brooklyn Bridge-City Hall / Chambers St     4min, 11min, 20min
   * 
   * 
   * @param {string} line
   * @param {string} dest
   * @param {[number]} times
   * 
   * @returns {HTMLLIElement}
   */
  generateTrainLine: function (line, dest, times) {
    var listItem = document.createElement('li');

    const expressTextClass = this.isExpress(line) ? 'mta__train--line-express-text' : '';

    const innerHtml =
      '<span class="mta mta__train mta__train--logo mta__train--line-' + line.toLowerCase().split("")[0] + " mta__train--line-" + this.isExpress(line) + '">' +
      '<span class="' + expressTextClass + '">' +
      line[0] +
      '</span>' +
      '</span>' +
      '<p class="mta_train--time_destination">' +
      dest +
      '</p>' +
      '<span class="mta mta_train mta__train--time mta__train-time__' + line + '">' +
      times.slice(0, 3)
        .map((trainTime, i) => {
          const time = '' +
            '<span class="mta__train--time_item train-time-' + line.toLowerCase() + '--' + i + '">' +
            trainTime + 'min' +
            '</span>';
          return time;
        }) +
      '</span>';

    listItem.className = 'mta__train--item mta__train--item-' + this.isExpress(line);
    listItem.innerHTML = innerHtml;

    return listItem;
  },

  /**
   * Generate an HTML Header for a list of trains, e.g.
   * 
   * --- Uptown ---------------------------------------
   * 
   * @param {string} title 
   * 
   * @returns {HTMLHeadingElement}
   */
  generateTrainListHeader: function (title) {
    const header = document.createElement('h2')
    header.className = 'mta__train--list--header'
    header.innerHTML = '' +
      '<span class="mta__train--list--header_text">' +
      title +
      '</span>'

    return header
  },

  /**
   * Generates an HTML Div which is used as a header and contains the station name and train lines.
   * Example,
   * 
   * Lexington Avenue / 51st Street (6)(E)(M)
   * 
   * @param {number} complexId 
   * 
   * @returns {HTMLDivElement}
   */
  generateStationHeader: function (complexId) {
    var station = document.createElement('div')
    station.className = 'mta__station'

    const station_details = COMPLEX_ID_STATION_NAME_MAP[complexId];

    var stationHTML =
      '<h2 class="mta__station--title">' +
      station_details.name +
      '</h2>' +
      '<div class="mta__station--list">' +
      '<div class="mta__station--list_container">' +
      station_details.lines
        .map((line, _i) => {
          const logo = '' +
            '<span class="mta mta__train mta__train--logo mta__train--line-' + line.toLowerCase() + '">' +
            line +
            '</span>';
          return logo;
        })
        .join('') +
      '</div>' +
      '</div>';
    station.innerHTML = stationHTML;

    return station
  },

  /**
    * @param {number} stationId
    * 
    * @returns {HTMLDivElement}
    */
  generateBusStopHeader: function (stationId) {
    var station = document.createElement('div')
    station.className = 'mta__bus-station'

    const station_details = BUS_STOP_ID_TO_NAME_MAP[stationId];

    var stationHTML =
      '<h2 class="mta__station--title">' +
      station_details.name +
      '</h2>' +
      '<div class="mta__station--list">' +
      '<div class="mta__station--list_container">' +
      station_details.lines
        .map((line, _i) => {
          const logo = '' +
            '<span class="mta mta__bus--logo mta__bus--line-' + line.toLowerCase() + '">' +
            line +
            '</span>';
          return logo;
        })
        .join('') +
      '</div>' +
      '</div>';
    station.innerHTML = stationHTML;

    return station
  },

  /**
   * Generate an HTML Line Item for a single bus line, e.g.
   * 
   * (M15) Brooklyn Bridge-City Hall / Chambers St     4min, 11min, 20min
   * 
   * 
   * @param {string} line
   * @param {string} dest
   * @param {{ minutes: number, isPredicted: boolean }[]} times
   * 
   * @returns {HTMLLIElement}
   */
   generateBusArrival: function (line, dest, times) {
    var listItem = document.createElement('li');

    const destFormatted = dest.split(' ')
      .map((word) => word.toLowerCase())
      .map((word) => word[0].toUpperCase() + word.substr(1))
      .join(' ');

    const innerHtml =
      '<span class="mta mta__bus--logo mta__bus--line-' + line.toLowerCase() + '">' +
      line +
      '</span>' +
      '<p class="mta_train--time_destination">' +
      destFormatted +
      '</p>' +
      '<span class="mta mta_train mta__train--time mta__train-time__' + line + '">' +
      times.map((busTime, i) => {
          const nonPredictedClass = busTime.isPredicted ? "" : " mta__bus--time_not-predicted";
          const time = '' +
            '<span class="mta__train--time_item train-time-' + line.toLowerCase() + '--' + i + nonPredictedClass + '">' +
            busTime.minutes + 'min' +
            '</span>';
          return time;
        }) +
      '</span>';

    listItem.className = 'mta__train--item mta__train--item-' + this.isExpress(line);
    listItem.innerHTML = innerHtml;

    return listItem;
  },

  isExpress: function (id) {
    return id.split('').length === 2 ? 'express' : ''
  },

  isSIR: function (id) {
    return id === 'SI' ? 'SIR' : id === 'SS' ? 'SIR' : id
  },

  getDepartures: function () {
    var config = this.config

    this.sendSocketNotification('GET_DEPARTURES', config)
  },

  scheduleUpdate: function (delay) {
    var loadTime = this.config.updateInterval
    var that = this

    if (typeof delay !== 'undefined' && delay >= 0) {
      loadTime = delay
    }

    setInterval(function () {
      that.getDepartures()
    }, loadTime)
  },

  /**
   * Returns whether or not two arrays contain the same elements
   * 
   * @template T
   * @param {[T]} a 
   * @param {[T]} b 
   * 
   * @returns {boolean}
   */
  arrayEquals: function (a, b) {
    if (a.length !== b.length) {
      return false
    } else {
      return a.every(element => {
        return b.includes(element)
      })
    }
  },

  socketNotificationReceived: function (notification, payload) {
    /** @type {[string]} */
    const myStations = this.config.stations.map((obj) => obj.stationId);

    if (notification === 'TRAIN_TABLE') {
      /** @type {[StationData]} */
      const stationResults = payload;
      const returnedStations = stationResults.map((data) => data.complexId);

      if (!this.arrayEquals(myStations, returnedStations)) {
        console.log("Got different stations than requested")
        console.log('requested: ', myStations)
        console.log('returned: ', returnedStations)
      }

      // eslint-disable-next-line no-console
      console.log('socketNotificationReceived: "TRAIN_TABLE": ', stationResults)

      this.result = stationResults
      this.updateDom(this.config.fadeSpeed)
    } else if (notification === "BUS_TABLE") {
      const busResults = payload;
      console.log("socketNotificationReceived: BUS_TABLE: ", busResults);

      this.busResults = payload;
      this.updateDom(this.config.fadeSpeed)
    } else if (notification === 'DOM_OBJECTS_CREATED') {
      // eslint-disable-next-line no-console
      console.log('Dom Objects Created')
    }
  },
})

/**
 * Returns if the array does not exist, or is empty.
 * 
 * @param {any[] | undefined | null} array 
 * 
 * @returns Boolean
 */
const arrayIsEmpty = (array) => {
  return !Array.isArray(array) || array.length === 0;
}

/** @type {Object.<number, StationDetails>} */
const COMPLEX_ID_STATION_NAME_MAP = {
  277: {
    name: "7 Av",
    lines: ["E", "D", "B"]
  },
  396: {
    name: "Lexington Av / 96th Street",
    lines: ["6"]
  },
  475: {
    name: "2nd Av / 96th Street",
    lines: ["Q"]
  },
  612: {
    name: "Lexington Av / 51 St",
    lines: ["M", "E", "6"]
  },
  613: {
    name: "Lexington Av / 59 St",
    lines: ["6", "5", "4", "W", "R", "N"],
  },
}

/** @type {Object.<number, StationDetails>} */
const BUS_STOP_ID_TO_NAME_MAP = {
  401701: {
    name: "1st Ave / Mitchell Place",
    lines: ["M15-SBS", "M15"]
  },
  401479: {
    name: "2nd Ave / 96 St",
    lines: ["M15"]
  },
  401768: {
    name: "2nd Ave / 50 St",
    lines: ["M15-SBS", "M15"]
  },
  405516: {
    name: "2nd Ave / 96 St",
    lines: ["M15-SBS"]
  },
  401920: {
    name: "86th St / 2nd Ave",
    lines: ["M86-SBS"],
  },
  403632: {
    name: "96th St / 2nd Ave",
    lines: ["M96"],
  }
}

/**
 * @typedef StationData
 * @type {object}
 * @property {string} complexId
 * @property {[ArrivalData]} upTownArrivals
 * @property {[ArrivalData]} downTownArrivals
 * 
 * Needs to be kept in sync with `StationData` in node_helper.js
 */

/**
 * @typedef ArrivalData
 * @type {object}
 * @property {string} routeId
 * @property {number} minutes
 * @property {string} destination
 * 
 * Needs to be kept in sync with `StationData` in node_helper.js
 */

/**
 * @typedef BusData
 * @type {object}
 *
 * @property {BusStopData[]} stops
 * @property {Situation[]} situations
 * 
 * Needs to be kept in sync with `BusData` in node_helper.js
 */

/**
 * @typedef Situation
 * @type {object}
 *
 * @property {string[]} affectedLineRef
 * @property {string} summary
 * 
 * Needs to be kept in sync with `Situation` in node_helper.js
 */

/**
 * @typedef BusStopData
 * @type {object}
 *
 * @property {number} stopId
 * @property {BusArrivalData[]} arrivals
 * 
 * Needs to be kept in sync with `BusStopData` in node_helper.js
 */

/**
 * @typedef BusArrivalData
 * @type {object}
 *
 * @property {string} name
 * @property {number} minutes
 * @property {boolean} isPredicted
 *
 * @property {string} lineRef
 * @property {string} overallDestination
 * 
 * Needs to be kept in sync with `BusArrivalData` in node_helper.js
 */

/**
 * @typedef StationDetails
 * @type {object}
 * @property {string} name
 * @property {string[]} lines
 */
