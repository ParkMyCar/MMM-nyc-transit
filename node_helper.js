// @ts-check

/* Magic Mirror
 * Module: MMM-NYC-transit
 *
 * By Elan Trybuch https://github.com/elaniobro
 * MIT Licensed.
 */

// @ ts-ignore
var NodeHelper = require('node_helper')

var { createClient } = require('mta-realtime-subway-departures')
var fs = require('fs-extra')
var mtaStationIds = require('mta-subway-stations')

const fetch = require('node-fetch');
const util = require('util')

const STOP_MONITORING_URL = "https://bustime.mta.info/api/siri/stop-monitoring.json";

const STOP_MONITORING_VERSION = "1";
const STOP_MONITORING_OPERATOR_REF = "MTA";

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

    /** @type {Map<number, string[]>} */
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

        /** @type {StationData[]} */
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

  /**
   * 
   * @param {string} apiKey - API Key provided by the [MTA](http://bt.mta.info/wiki/Developers/Index)
   * @param {number} stopId - Stop ID, can be found in stops/<borough>.txt
   */
  fetchTimes: function (apiKey, stopId) {
    var fetchUrl = new URL(STOP_MONITORING_URL);
    fetchUrl.searchParams.append("version", STOP_MONITORING_VERSION);
    fetchUrl.searchParams.append("key", apiKey);
    fetchUrl.searchParams.append("OperatorRef", STOP_MONITORING_OPERATOR_REF);
    fetchUrl.searchParams.append("MonitoringRef", stopId.toString());

    // @ts-ignore
    fetch(fetchUrl)
      .then(response => response.json())
      .then(json => {
        const result = json.Siri.ServiceDelivery;

        /** @type {[any]} */
        const monitoredStops = result.StopMonitoringDelivery[0].MonitoredStopVisit;
        const stops = monitoredStops
          .map((obj) => obj.MonitoredVehicleJourney)
          .map((obj) => {
            /** @type {VehicleLocation} */
            const location = {
              longitude: obj.VehicleLocation.Longitude || 0,
              latitude: obj.VehicleLocation.Latitude || 0,
            };

            const extensions = obj.MonitoredCall.Extensions || {};
            const distances = extensions.Distances || {};
            const capacities = extensions.Capacities || {};

            /** @type {MonitoredCall} */
            const monitoredCall = {
              aimedArrivalTime: obj.MonitoredCall.AimedArrivalTime || "",
              aimedDepartureTime: obj.MonitoredCall.AimedDepartureTime || "",
              expectedArrivalTime: obj.MonitoredCall.ExpectedArrivalTime || null,
              expectedDepartureTime: obj.MonitoredCall.ExpectedDepartureTime || null,
              extensions: {
                distances: {
                  presentableDistance: distances.PresentableDistance || null,
                  distanceFromCall: distances.DistanceFromCall || null,
                  stopsFromCall: distances.StopsFromCall || null,
                  callDistanceAlongRoute: distances.CallDistanceAlongRoute || null,
                },
                capacities: {
                  estimatedPassengerCount: capacities.EstimatedPassengerCount || null,
                },
              },
              stopPointRef: obj.MonitoredCall.StopPointRef || "",
            }

            /** @type {MonitoredVehicleJourney} */
            const stop = {
              lineRef: obj.LineRef || "",
              directionRef: obj.DirectionRef || "",
              operatorRef: obj.OperatorRef || "",
              originRef: obj.OriginRef || "",
              vehicleRef: obj.VehicleRef || "",
              publishedLineName: obj.PublishedLineName || "",
              destinationName: obj.DestinationName || "",
              location: location,
              bearing: obj.Bearing || 0,
              monitoredCall: monitoredCall,
              recordedAtTime: obj.RecorededAtTime || "",
            };
            return stop;
          });
        console.log(util.inspect(stops, false, null, true /* enable colors */))
      });
  },

  getDate: function (time, walkingTime) {
    // time is a unix_timestamp
    const now = Math.round(new Date().getTime() / 1000)
    const secdiff = time - now
    const mindiff = Math.floor(secdiff / 60)
    const mindiffStr = '0' + (mindiff % 60)

    // Will display time in minutes format
    const formattedTime = Number(mindiffStr.substr(-2))

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
 * @property {ArrivalData[]} upTownArrivals
 * @property {ArrivalData[]} downTownArrivals
 */

/**
 * @typedef ArrivalData
 * @type {object}
 * @property {string} routeId
 * @property {number} minutes
 * @property {string} destination
 */

/**
 * @typedef {import('node-fetch').Response} Response
 */

/**
 * @typedef StopMonitoring
 * @type {Object}
 *
 * @property {[MonitoredVehicleJourney]} stops
 * @property {[SituationElement]} situations
 */

/**
 * @typedef MonitoredVehicleJourney
 * @type {Object}
 *
 * @property {string} lineRef - The 'fully qualified' route name (GTFS agency ID + route ID) for the
 *  trip the vehicle is serving. Not intended to be customer-facing.
 * @property {string} directionRef - The GTFS direction for the trip the vehicle is serving
 * @property {string} operatorRef - GTFS Agency_ID
 * @property {string} originRef - The GTFS stop ID for the first stop on the trip the vehicle is 
 *  serving, prefixed by Agency ID
 * @property {string} vehicleRef - The vehicle ID, preceded by the GTFS agency ID
 *
 * @property {string} publishedLineName - The GTFS route_short_name
 * @property {string} destinationName - The GTFS trip_headsign for the trip the vehicle is serving
 *
 * @property {VehicleLocation} location
 * @property {number} bearing - Vehicle bearing: 0 is East, increments counter-clockwise
 * 
 * @property {MonitoredCall} monitoredCall - Position of the vehicle
 *
 * @property {string} recordedAtTime
 */

/**
 * Call data about a particular stop. In StopMonitoring, it is the stop of interest; in 
 * VehicleMonitoring it is the next stop the bus will make.
 * 
 * @typedef MonitoredCall
 * @type {Object}
 *
 * @property {(string|null)} expectedArrivalTime - Predicted arrival time in ISO8601 format
 * @property {(string|null)} expectedDepartureTime - Predicted departure time in ISO8601 format
 * 
 * @property {string} aimedArrivalTime - Original scheduled arrival time, in ISO8601 format
 * @property {string} aimedDepartureTime - Original scheduled departure time, in ISO8601 format
 * 
 * @property {string} stopPointRef - The GTFS stop ID of the stop prefixed by agency_id
 * 
 * @property {MonitoredCallExtensions} extensions
 */

/**
 * The most recently recorded or inferred coordinates of this vehicle
 * 
 * @typedef VehicleLocation
 * @type {Object}
 *
 * @property {number} longitude
 * @property {number} latitude
 */

/**
 * SIRI container for extensions to the standard
 * 
 * @typedef MonitoredCallExtensions
 * @type {Object}
 * 
 * @property {Distances} distances
 * @property {Capacities} capacities
 */

/**
 * The MTA Bus Time extensions to show distance of the vehicle from the stop
 * 
 * @typedef Distances
 * @type {Object}
 * 
 * @property {(string | null)} presentableDistance - The distance displayed in the UI, see below for an additional note
 * @property {(number | null)} distanceFromCall - The distance from the vehicle to the stop along the route, in meters
 * @property {(number | null)} stopsFromCall - The number of stops on the vehicle's current trip until the stop in question, starting from 0
 * @property {(number | null)} callDistanceAlongRoute - The distance of the stop from the beginning of the trip/route
 */

/**
 * @typedef Capacities
 * @type {Object}
 * 
 * @property {(number | null)} estimatedPassengerCount
 */

/**
 * @typedef SituationElement
 * @type {Object}
 * 
 * @property {PublicationWindow} publicationWindow
 * @property {string} severity
 * @property {string} summary
 * @property {string} description
 * 
 * @property {AffectedVehicleJourneys} affects
 * 
 * @property {string} creationTime
 * @property {string} situationNumber
 */

/**
 * @typedef PublicationWindow
 * @type {Object}
 * 
 * @property {string} startTime - Start time of Service Alert
 * @property {string} endTime - End time of Service Alert
 */

/**
 * @typedef AffectedVehicleJourneys
 * @type {Object}
 * 
 * @property { [{ lineRef: string, directionRef: string }] } vehicleJourneys
 */
