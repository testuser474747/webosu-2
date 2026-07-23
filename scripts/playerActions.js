define([], function () {
  var checkClickdown = function checkClickdown() {
    var upcoming = playback.upcomingHits;
    var click = {
      x: playback.game.mouseX,
      y: playback.game.mouseY,
      time: playback.osu.audio.getPosition() * 1000,
    };
    var hit = upcoming.find(inUpcoming(click));
    if (hit) {
      if (hit.type == "circle" || hit.type == "slider") {
        let points = 50;
        let diff = click.time - hit.time;
        if (Math.abs(diff) < playback.GoodTime) points = 100;
        if (Math.abs(diff) < playback.GreatTime) points = 300;
        playback.hitSuccess(hit, points, click.time);
      }
    }
  };

  var inUpcoming = function (click) {
    return function (hit) {
      var dx = click.x - hit.x;
      var dy = click.y - hit.y;
      return (
        hit.score < 0 &&
        dx * dx + dy * dy < playback.circleRadius * playback.circleRadius &&
        Math.abs(click.time - hit.time) < playback.MehTime
      );
    };
  };

  var playerActions = function (playback) {
    playback.auto = {
      currentObject: null,
      curid: 0,
      lastx: playback.game.mouseX,
      lasty: playback.game.mouseY,
      lasttime: 0,
    };
    if (playback.autoplay) {
      playback.game.updatePlayerActions = autoMod;
    } else if (playback.relax) {
      playback.game.updatePlayerActions = relaxMod;
    } else if (playback.autopilot) {
      playback.game.updatePlayerActions = autopilotMod;
    }

    function relaxMod(time) {
      playback.game.down = true;
      let cur = playback.hits[playback.auto.curid];
      if (!cur) return;
      let finalTime = cur.judgements[cur.judgements.length - 1].finalTime;
      if (cur.score < 0) {
        if (time >= finalTime) {
          playback.auto.curid++;
        } else if (cur.time <= time) {
          checkClickdown();
        }
      } else {
        playback.auto.curid++;
      }
    }

    function autopilotMod(time) {
      const spinRadius = 60;
      let cur = playback.hits[playback.auto.curid];
      if (!cur) return;
      let finalTime = cur.judgements[cur.judgements.length - 1].finalTime;
      let finalScore = cur.judgements[cur.judgements.length - 1].points;

      if (finalScore < 0) {
        if (time >= finalTime) {
          //current obj time out, save status and go to next obj
          playback.auto.curid++;
          playback.auto.lasttime = finalTime;
          playback.auto.lastx = playback.game.mouseX;
          playback.auto.lasty = playback.game.mouseY;
        } else if (cur.type != "circle" && time > cur.time) {
          //moving the cursor on slider or spin
          if (cur.type == "slider") {
            // follow slider ball
            playback.game.mouseX = cur.ball.x || cur.x;
            playback.game.mouseY = cur.ball.y || cur.y;
          } else {
            // spin
            let currentAngle = Math.atan2(
              playback.game.mouseY - cur.y,
              playback.game.mouseX - cur.x
            );
            currentAngle += 0.8;
            playback.game.mouseY = cur.y + spinRadius * Math.sin(currentAngle);
            playback.game.mouseX = cur.x + spinRadius * Math.cos(currentAngle);
          }
        } else {
          //moving the cursor to next obj
          let targX = cur.x;
          let targY = cur.y;
          if (cur.type == "spinner") targY -= spinRadius;
          let t =
            (time - playback.auto.lasttime) /
            Math.max(0, cur.time - playback.auto.lasttime);
          t = Math.max(0, Math.min(1, t));
          t = 0.5 - Math.sin((Math.pow(1 - t, 3) - 0.5) * Math.PI) / 2; // easing
          playback.game.mouseX = t * targX + (1 - t) * playback.auto.lastx;
          playback.game.mouseY = t * targY + (1 - t) * playback.auto.lasty;
        }
      } else {
        //current obj finish, save status and go to next obj
        playback.auto.curid++;
        playback.auto.lasttime = time;
        playback.auto.lastx = playback.game.mouseX;
        playback.auto.lasty = playback.game.mouseY;
      }
    }

    function autoMod(time) {
      const spinRadius = 60;
      let cur = playback.auto.currentObject;
      // auto move cursor
      if (playback.game.down && cur) {
        // already on an object
        if (cur.type == "circle" || time > cur.endTime) {
          // release cursor
          playback.game.down = false;
          playback.auto.currentObject = null;
          playback.auto.lasttime = time;
          playback.auto.lastx = playback.game.mouseX;
          playback.auto.lasty = playback.game.mouseY;
        } else if (cur.type == "slider") {
          // follow slider ball
          playback.game.mouseX = cur.ball.x || cur.x;
          playback.game.mouseY = cur.ball.y || cur.y;
        } else {
          // spin
          let currentAngle = Math.atan2(
            playback.game.mouseY - cur.y,
            playback.game.mouseX - cur.x
          );
          currentAngle += 0.8;
          playback.game.mouseY = cur.y + spinRadius * Math.sin(currentAngle);
          playback.game.mouseX = cur.x + spinRadius * Math.cos(currentAngle);
        }
      }
      // looking for next target
      cur = playback.auto.currentObject;
      while (
        playback.auto.curid < playback.hits.length &&
        playback.hits[playback.auto.curid].time < time
      ) {
        if (playback.hits[playback.auto.curid].score < 0) {
          playback.game.mouseX = playback.hits[playback.auto.curid].x;
          playback.game.mouseY = playback.hits[playback.auto.curid].y;
          if (playback.hits[playback.auto.curid].type == "spinner")
            playback.game.mouseY -= spinRadius;
          playback.game.down = true;
          checkClickdown();
        }
        ++playback.auto.curid;
      }
      if (!cur && playback.auto.curid < playback.hits.length) {
        cur = playback.hits[playback.auto.curid];
        playback.auto.currentObject = cur;
      }
      if (!cur || cur.time > time + playback.approachTime) {
        // no object to click, just rest
        playback.auto.lasttime = time;
        return;
      }
      if (!playback.game.down) {
        // move toward the object
        let targX = cur.x;
        let targY = cur.y;
        if (cur.type == "spinner") targY -= spinRadius;
        let t =
          (time - playback.auto.lasttime) / (cur.time - playback.auto.lasttime);
        t = Math.max(0, Math.min(1, t));
        t = 0.5 - Math.sin((Math.pow(1 - t, 1.5) - 0.5) * Math.PI) / 2; // easing
        playback.game.mouseX = t * targX + (1 - t) * playback.auto.lastx;
        playback.game.mouseY = t * targY + (1 - t) * playback.auto.lasty;

        let diff = time - cur.time;
        if (diff > -8) {
          // click the object
          playback.game.down = true;
          checkClickdown();
        }
      }
    }

    var mousemoveCallback = function (e) {
      if (playback.autopilot) return;
      playback.game.mouseX = ((e.clientX - gfx.xoffset) / gfx.width) * 512;
      playback.game.mouseY = ((e.clientY - gfx.yoffset) / gfx.height) * 384;
    };
    var mousedownCallback = function (e) {
      mousemoveCallback(e);
      if (e.button == 0) {
        if (playback.game.M1down) return;
        playback.game.M1down = true;
      } else if (e.button == 2) {
        if (playback.game.M2down) return;
        playback.game.M2down = true;
      } else return;
      e.preventDefault();
      e.stopPropagation();
      playback.game.down =
        playback.game.K1down ||
        playback.game.K2down ||
        playback.game.M1down ||
        playback.game.M2down;
      checkClickdown();
    };
    var mouseupCallback = function (e) {
      mousemoveCallback(e);
      if (e.button == 0) playback.game.M1down = false;
      else if (e.button == 2) playback.game.M2down = false;
      else return;
      e.preventDefault();
      e.stopPropagation();
      playback.game.down =
        playback.game.K1down ||
        playback.game.K2down ||
        playback.game.M1down ||
        playback.game.M2down;
    };
        var cursorTouchId = null;
    var activeTouchCount = 0;

    // Prevent cursor ownership rapidly switching when two fingers
    // are almost the same distance from the note.
    var CURSOR_SWITCH_HYSTERESIS = 12; // osu! pixels

    var touchToOsu = function (touch) {
      return {
        x: ((touch.clientX - gfx.xoffset) / gfx.width) * 512,
        y: ((touch.clientY - gfx.yoffset) / gfx.height) * 384,
      };
    };

    var findTouchById = function (touches, identifier) {
      if (identifier === null) return null;

      for (var i = 0; i < touches.length; i++) {
        if (touches[i].identifier === identifier) {
          return touches[i];
        }
      }

      return null;
    };

    var getTouchTarget = function () {
      var now = playback.osu.audio.getPosition() * 1000;

      /*
       * Prefer an active slider or spinner. This prevents cursor ownership
       * changing to the next circle while the player is holding a slider.
       */
      var activeLongObject = playback.upcomingHits.find(function (hit) {
        return (
          !hit.destroyed &&
          (hit.type === "slider" || hit.type === "spinner") &&
          hit.time <= now &&
          hit.endTime >= now
        );
      });

      if (activeLongObject) {
        if (
          activeLongObject.type === "slider" &&
          activeLongObject.ball
        ) {
          return {
            x: activeLongObject.ball.x,
            y: activeLongObject.ball.y,
          };
        }

        return {
          x: activeLongObject.x,
          y: activeLongObject.y,
        };
      }

      // upcomingHits is ordered, so this selects the next playable note.
      var nextHit = playback.upcomingHits.find(function (hit) {
        return (
          !hit.destroyed &&
          hit.score < 0 &&
          hit.time >= now - playback.MehTime
        );
      });

      if (!nextHit) return null;

      return {
        x: nextHit.x,
        y: nextHit.y,
      };
    };

    var chooseCursorTouch = function (touches) {
      if (!touches || touches.length === 0) {
        cursorTouchId = null;
        return null;
      }

      var currentTouch = findTouchById(touches, cursorTouchId);
      var target = getTouchTarget();

      /*
       * When no note is available, preserve the existing cursor finger.
       * Only fall back to touches[0] when there was no previous cursor.
       */
      if (!target) {
        var fallback = currentTouch || touches[0];
        cursorTouchId = fallback.identifier;
        return fallback;
      }

      var bestTouch = touches[0];
      var bestPoint = touchToOsu(bestTouch);
      var bestDistance =
        Math.pow(bestPoint.x - target.x, 2) +
        Math.pow(bestPoint.y - target.y, 2);

      for (var i = 1; i < touches.length; i++) {
        var point = touchToOsu(touches[i]);
        var distance =
          Math.pow(point.x - target.x, 2) +
          Math.pow(point.y - target.y, 2);

        if (distance < bestDistance) {
          bestTouch = touches[i];
          bestDistance = distance;
        }
      }

      /*
       * Keep the current cursor finger unless another finger is
       * meaningfully closer. This avoids jitter around equal distances.
       */
      if (
        currentTouch &&
        currentTouch.identifier !== bestTouch.identifier
      ) {
        var currentPoint = touchToOsu(currentTouch);
        var currentDistance =
          Math.pow(currentPoint.x - target.x, 2) +
          Math.pow(currentPoint.y - target.y, 2);

        if (
          Math.sqrt(currentDistance) <=
          Math.sqrt(bestDistance) + CURSOR_SWITCH_HYSTERESIS
        ) {
          bestTouch = currentTouch;
        }
      }

      cursorTouchId = bestTouch.identifier;
      return bestTouch;
    };

    var updateCursorFromTouches = function (touches) {
      // In Autopilot, touches should click but never move the cursor.
      if (playback.autopilot) return;

      var cursorTouch = chooseCursorTouch(touches);
      if (!cursorTouch) return;

      var point = touchToOsu(cursorTouch);
      playback.game.mouseX = point.x;
      playback.game.mouseY = point.y;
    };

    var updateTouchButtons = function (touches) {
      activeTouchCount = Math.min(
        touches ? touches.length : 0,
        2
      );

      /*
       * One active touch is M1; two active touches are M1 + M2.
       * The identity does not matter for holding sliders—only whether
       * at least one contact remains down.
       */
      playback.game.M1down = activeTouchCount >= 1;
      playback.game.M2down = activeTouchCount >= 2;

      playback.game.down =
        playback.game.K1down ||
        playback.game.K2down ||
        playback.game.M1down ||
        playback.game.M2down;
    };

    var touchmoveCallback = function (e) {
      if (playback.game.paused || playback.ended) return;

      e.preventDefault();
      updateCursorFromTouches(e.touches);
    };

    var touchstartCallback = function (e) {
      if (playback.game.paused || playback.ended) return;

      e.preventDefault();

      /*
       * Select the closest finger first, then judge the press at that
       * cursor location. A farther newly-added finger therefore causes
       * a click without teleporting the cursor to that finger.
       */
      updateCursorFromTouches(e.touches);

      // Relax mode moves the cursor but generates clicks automatically.
      if (!playback.relax) {
        var previousTouchCount = activeTouchCount;
        updateTouchButtons(e.touches);

        // Do not generate additional presses for third/fourth fingers.
        if (activeTouchCount > previousTouchCount) {
          checkClickdown();
        }
      }
    };

    var touchendCallback = function (e) {
      /*
       * Release touch buttons even if the game became paused while a
       * finger was held, preventing a permanently stuck game.down state.
       */
      if (!playback.relax) {
        updateTouchButtons(e.touches);
      }

      if (playback.game.paused || playback.ended) return;

      e.preventDefault();

      /*
       * If the cursor finger ended, choose the closest remaining finger.
       * With no remaining touches, keep the cursor at its last position.
       */
      updateCursorFromTouches(e.touches);
    };

    var touchcancelCallback = touchendCallback;
    var keydownCallback = function (e) {
      if (e.keyCode == playback.game.K1keycode) {
        if (playback.game.K1down) return;
        playback.game.K1down = true;
      } else if (e.keyCode == playback.game.K2keycode) {
        if (playback.game.K2down) return;
        playback.game.K2down = true;
      } else return;
      e.preventDefault();
      e.stopPropagation();
      playback.game.down =
        playback.game.K1down ||
        playback.game.K2down ||
        playback.game.M1down ||
        playback.game.M2down;
      checkClickdown();
    };
    var keyupCallback = function (e) {
      if (e.keyCode == playback.game.K1keycode) playback.game.K1down = false;
      else if (e.keyCode == playback.game.K2keycode)
        playback.game.K2down = false;
      else return;
      e.preventDefault();
      e.stopPropagation();
      playback.game.down =
        playback.game.K1down ||
        playback.game.K2down ||
        playback.game.M1down ||
        playback.game.M2down;
    };

        var touchSupported =
      "ontouchstart" in window ||
      navigator.maxTouchPoints > 0;

    /*
     * Normal:
     *   move cursor + click
     *
     * Relax:
     *   move cursor, no manual click
     *
     * Autopilot:
     *   click, no cursor movement
     *
     * Autoplay:
     *   no player input
     */
    if (touchSupported && !playback.autoplay) {
      playback.game.window.addEventListener(
        "touchstart",
        touchstartCallback,
        { passive: false }
      );

      playback.game.window.addEventListener(
        "touchmove",
        touchmoveCallback,
        { passive: false }
      );

      playback.game.window.addEventListener(
        "touchend",
        touchendCallback,
        { passive: false }
      );

      playback.game.window.addEventListener(
        "touchcancel",
        touchcancelCallback,
        { passive: false }
      );
    }

    playback.game.cleanupPlayerActions = function () {
      playback.game.window.removeEventListener("mousemove", mousemoveCallback);
      playback.game.window.removeEventListener("mousedown", mousedownCallback);
      playback.game.window.removeEventListener("mouseup", mouseupCallback);
      playback.game.window.removeEventListener("keydown", keydownCallback);
      playback.game.window.removeEventListener("keyup", keyupCallback);
      playback.game.window.removeEventListener("touchmove", touchmoveCallback);
      playback.game.window.removeEventListener(
        "touchstart",
        touchstartCallback
      );
      playback.game.window.removeEventListener("touchend", touchendCallback);
      playback.game.window.removeEventListener(
        "touchcancel",
        touchcancelCallback
      );
    };
  };

  // https://tc39.github.io/ecma262/#sec-array.prototype.find
  if (!Array.prototype.find) {
    Object.defineProperty(Array.prototype, "find", {
      value: function (predicate) {
        // 1. Let O be ? ToObject(this value).
        if (this == null) {
          throw new TypeError('"this" is null or not defined');
        }

        var o = Object(this);

        // 2. Let len be ? ToLength(? Get(O, "length")).
        var len = o.length >>> 0;

        // 3. If IsCallable(predicate) is false, throw a TypeError exception.
        if (typeof predicate !== "function") {
          throw new TypeError("predicate must be a function");
        }

        // 4. If thisArg was supplied, let T be thisArg; else let T be undefined.
        var thisArg = arguments[1];

        // 5. Let k be 0.
        var k = 0;

        // 6. Repeat, while k < len
        while (k < len) {
          // a. Let Pk be ! ToString(k).
          // b. Let kValue be ? Get(O, Pk).
          // c. Let testResult be ToBoolean(? Call(predicate, T, « kValue, k, O »)).
          // d. If testResult is true, return kValue.
          var kValue = o[k];
          if (predicate.call(thisArg, kValue, k, o)) {
            return kValue;
          }
          // e. Increase k by 1.
          k++;
        }

        // 7. Return undefined.
        return undefined;
      },
      configurable: true,
      writable: true,
    });
  }
  return playerActions;
});
