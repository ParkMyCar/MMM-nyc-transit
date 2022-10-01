/* Magic Mirror
 * Module: MMM-NYC-transit
 *
 * By Elan Trybuch https://github.com/elaniobro
 * MIT Licensed.
 */

var NodeHelper = require('node_helper')
var { createClient } = require('mta-realtime-subway-departures')
var fs = require('fs-extra')
var mtaStationIds = require('mta-subway-stations')
const util = require('util')

module.exports = NodeHelper.create({
  start: function () {
    console.log(this.name + ' helper method started...'); /*eslint-disable-line*/
  },

  getDepartures: function (config) {
    var apiKey = config.apiKey
    var client = createClient(apiKey)
    var self = this
    var stations = config.stations.map((obj) => obj.stationId)
    var stationIds = {}
    var walkingTime = config.stations.map((obj) => obj.walkingTime)

    var dirUpTown = config.stations.map((obj) => obj.dir.upTown)
    var dirDownTown = config.stations.map((obj) => obj.dir.downTown)

    /** @type {Map<number, [string]>} */
    const ignoredRoutesPerStation = new Map(config.stations.map((obj) => [obj.stationId, obj.ignore]))

    fs.readFile(
      `${__dirname}/node_modules/mta-subway-complexes/complexes.json`,
      'utf8'
    )
      .then((data) => {
        stationIds = JSON.parse(data)
      })
      .catch((err) => {
        throw new Error(err)
      })

    client
      .departures(stations)
      .then((responses) => {
        // console.log(util.inspect(responses, false, null, true /* enable colors */))

        if (responses.length === undefined) {
          var temp = responses

          responses = []
          responses.push(temp)
        }

        /** @type {[StationData]} */
        var result = []

        responses.forEach((response, n) => {
          /** @type {StationData} */
          var stationData = {
            complexId: response.complexId,
            upTownArrivals: [],
            downTownArrivals: [],
          }

          const ignoredRoutes = ignoredRoutesPerStation.get(response.complexId) || []

          response.lines.forEach((line) => {
            // Southbound Departures
            line.departures.S.forEach((i) => {
              for (var key in mtaStationIds) {
                if (i.destinationStationId === mtaStationIds[key]['Station ID']) {
                  i.destinationStationId = mtaStationIds[key]['Complex ID']
                }
              }

              if (i.destinationStationId !== undefined && dirDownTown[n] && !ignoredRoutes.includes(i.routeId)) {
                /** @type {ArrivalData} */
                const arrival = {
                  routeId: i.routeId,
                  minutes: this.getDate(i.time, walkingTime[n]),
                  destination: i.destinationStationId === '281'
                    ? stationIds['606'].name
                    : stationIds[i.destinationStationId].name,
                };
                stationData.downTownArrivals.push(arrival);
              }
            })

            // Nothbound Departures
            line.departures.N.forEach((i) => {
              for (var key in mtaStationIds) {
                if (i.destinationStationId === mtaStationIds[key]['Station ID']) {
                  i.destinationStationId = mtaStationIds[key]['Complex ID']
                }
              }

              if (i.destinationStationId !== undefined && dirUpTown[n] && !ignoredRoutes.includes(i.routeId)) {
                /** @type {ArrivalData} */
                const arrival = {
                  routeId: i.routeId,
                  minutes: this.getDate(i.time, walkingTime[n]),
                  destination: i.destinationStationId === '281'
                    ? stationIds['606'].name
                    : stationIds[i.destinationStationId].name,
                };
                stationData.upTownArrivals.push(arrival);
              }
            })
          })

          // filter out arrivals that are 0 minutes away, aka arriving now
          stationData.upTownArrivals = stationData.upTownArrivals.filter((arrival) => arrival.minutes > 0)
          stationData.downTownArrivals = stationData.downTownArrivals.filter((arrival) => arrival.minutes > 0)

          result.push(stationData);
        })

        self.sendSocketNotification('TRAIN_TABLE', result);
      })
      .catch((err) => {
        throw new Error(err)
      })
  },

  getDate: function (time, walkingTime) {
    // time is a unix_timestamp
    var now = Math.round(new Date().getTime() / 1000)
    var secdiff = time - now
    var mindiff = Math.floor(secdiff / 60)

    mindiff = '0' + (mindiff % 60)

    // Will display time in minutes format
    var formattedTime = Number(mindiff.substr(-2))

    return formattedTime - (walkingTime || 0)
  },

  //Subclass socketNotificationReceived received.
  socketNotificationReceived: function (notification, config) {
    if (notification === 'GET_DEPARTURES') {
      this.getDepartures(config)
    }
  },
})

/**
 * @typedef StationData
 * @type {object}
 * @property {string} complexId
 * @property {[ArrivalData]} upTownArrivals
 * @property {[ArrivalData]} downTownArrivals
 */

/**
 * @typedef ArrivalData
 * @type {object}
 * @property {string} routeId
 * @property {number} minutes
 * @property {string} destination
 */
