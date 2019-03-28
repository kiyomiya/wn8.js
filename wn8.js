'use strict';

const fs = require('fs');
const http = require('http');

var wn8calc = function(api, search, accurate_calculation, missing_search, expected_tank_values_version) {
    this.api = api;
    this.search = search;
    this.expected_tank_values = [];
    this.search_missing_tanks = missing_search || false;
    this.accurate_calculation = accurate_calculation || false;
    this.expected_tank_values_version = expected_tank_values_version || 30;
    this.wn8 = 0;
    this.account_id;
    this.missing_tanks;
};

wn8calc.prototype.calc = function(success, error) {
    let scope = this;
    let account = {};
    if (typeof(scope.search) === 'string' || scope.search instanceof String) {
        scope.api.get(
                scope.api.getWotApi('ACCOUNTS', 'PLAYERS'), { fields: 'account_id', type: 'exact', search: scope.search }
            )
            .then(function(response) {
                scope.loadExpectedTankValues(scope.expected_tank_values_version);
                scope.account_id = response.data[0].account_id;
                return scope.getWN8(function() {
                    success(scope.wn8);
                });
            });
    } else {
        scope.account_id = scope.search;
        return scope.getWN8(function() {
            error();
        });
    }
};


wn8calc.prototype.loadExpectedTankValues = function(version) {
    const tankfile = './expected_tank_values_' + version + '.json';
    let scope = this;
    let tank_id = 'tank_';

    fs.access(tankfile, function(err) {
        if (err) {
            let outfile = fs.createWriteStream(tankfile);
            http.get('http://www.wnefficiency.net/exp/expected_tank_values_' + version + '.json', function(res) {
                res.pipe(tankfile);
                res.on('end', function() {
                    outfile.close();
                });
            });
        }

        scope.buff = require(tankfile);

        for (var i = 0; i < scope.buff.data.length; i++) {
            tank_id = 'tank_' + scope.buff.data[i].IDNum;
            scope.expected_tank_values[tank_id] = scope.buff.data[i];
        }
    });
};

/**
 * Calculate account WN8
 * 
 * @return   Integer
 */
wn8calc.prototype.getWN8 = function(callback) {
    let scope = this;

    scope.api.get(
        scope.api.getWotApi('ACCOUNTS', 'PLAYER_PERSONAL_DATA'), {
            fields: 'statistics.all.battles,statistics.all.frags,statistics.all.damage_dealt,statistics.all.dropped_capture_points,statistics.all.spotted,statistics.all.wins',
            account_id: scope.account_id,
            search: scope.search
        }
    ).then(function(response) {
        scope.summary = response.data[scope.account_id].statistics.all;
        // Get tanks values
        scope.api.get(
            scope.api.getWotApi('ACCOUNTS', 'PLAYERS_VEHICLES'), {
                'fields': 'tank_id,statistics.battles',
                'account_id': scope.account_id,
                'search': scope.search
            }
        ).then(function(response) {
            if (response.data[scope.account_id].length === 0) {
                scope.wn8 = 0;
                return this.wn8;
            }

            // WN8 expected calculation
            let tank_battles = 0;
            let expDAMAGE = 0;
            let expFRAGS = 0;
            let expSPOT = 0;
            let expDEF = 0;
            let expWIN = 0;
            let expected = 0;
            let tank = '';

            let rDAMAGE = 0;
            let rSPOT = 0;
            let rFRAG = 0;
            let rDEF = 0;
            let rWIN = 0;
            let rWINc = 0;
            let rDAMAGEc = 0;
            let rFRAGc = 0;
            let rSPOTc = 0;
            let rDEFc = 0;
            let wn8 = 0;

            // Tanks missing in expected tank values but existing in account
            let missing = [];

            // Calculated account expected values
            for (var i = 0; i < response.data[scope.account_id].length; i++) {
                tank = response.data[scope.account_id][i];
                if (scope.expected_tank_values['tank_' + tank.tank_id]) {
                    // Expected values for current tank
                    expected = scope.expected_tank_values['tank_' + tank.tank_id];

                    // Battles on current tank
                    tank_battles = tank.statistics.battles;
                    // Calculate expected values for current tank
                    expDAMAGE += expected.expDamage * tank_battles;
                    expSPOT += expected.expSpot * tank_battles;
                    expFRAGS += expected.expFrag * tank_battles;
                    expDEF += expected.expDef * tank_battles;
                    expWIN += 0.01 * expected.expWinRate * tank_battles;
                } else {
                    missing.push(tank.tank_id);
                }
            }

            if (scope.accurate_calculation && missing.length !== 0) {
                scope.missing_tanks = scope.api.get(
                    scope.api.getWotApi('PLAYERS_VEHICLES', 'VEHICLE_STATISTICS'), {
                        'tank_id': missing.join(','),
                        'fields': 'tank_id,all.battles,all.frags,all.damage_dealt,all.dropped_capture_points,all.spotted,all.wins',
                        'account_id': scope.account_id
                    }
                ).then(function(response) {
                    console.log(response);
                });

                // Reduce account summary data
                for (var i = 0; i < scope.missing_tanks.length; i++) {
                    let mistank = scope.missing_tanks[i];
                    scope.summary.damage_dealt -= mistank.all.damage_dealt;
                    scope.summary.spotted -= mistank.all.spotted;
                    scope.summary.frags -= mistank.all.frags;
                    scope.summary.dropped_capture_points -= mistank.all.dropped_capture_points;
                    scope.summary.wins -= mistank.all.wins;
                }
            }

            // If there are missing tanks and searching for info is set to TRUE, get those values
            if (missing.length !== 0 && scope.search_missing_tanks) {
                scope.missing_tanks = $this.api.get(
                    scope.api.getWotApi('TANKOPEDIA', 'VEHICLE_DETAILS'), {
                        'tank_id': missing.join(','),
                        'fields': 'localized_name'
                    }
                ).then(function(response) {
                    console.log(response);
                });
            }

            rDAMAGE = scope.summary.damage_dealt / expDAMAGE;
            rSPOT = scope.summary.spotted / expSPOT;
            rFRAG = scope.summary.frags / expFRAGS;
            rDEF = scope.summary.dropped_capture_points / expDEF;
            rWIN = scope.summary.wins / expWIN;
            rWINc = Math.max(0, (rWIN - 0.71) / (1 - 0.71));
            rDAMAGEc = Math.max(0, (rDAMAGE - 0.22) / (1 - 0.22));
            rFRAGc = Math.max(0, Math.min(rDAMAGEc + 0.2, (rFRAG - 0.12) / (1 - 0.12)));
            rSPOTc = Math.max(0, Math.min(rDAMAGEc + 0.1, (rSPOT - 0.38) / (1 - 0.38)));
            rDEFc = Math.max(0, Math.min(rDAMAGEc + 0.1, (rDEF - 0.10) / (1 - 0.10)));
            wn8 = 980 * rDAMAGEc + 210 * rDAMAGEc * rFRAGc + 155 * rFRAGc * rSPOTc + 75 * rDEFc * rFRAGc + 145 * Math.min(1.8, rWINc);

            // Ok we have WN8, store it
            scope.wn8 = Math.round(wn8, 2);

            callback();
        });
    });
}

module.exports = wn8calc;
