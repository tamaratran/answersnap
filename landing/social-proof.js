/**
 * Cheatly — Live social-proof toast
 * Shows a small bottom-left notification that someone just started a trial.
 */

(function () {
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (sessionStorage.getItem('cheatly_sp_dismissed')) return;

  var PEOPLE = [
    ['Alex M.', 'Austin, TX'],
    ['Maya R.', 'San Diego, CA'],
    ['Jake T.', 'Columbus, OH'],
    ['Sofia L.', 'Miami, FL'],
    ['Ethan K.', 'Seattle, WA'],
    ['Olivia P.', 'Denver, CO'],
    ['Noah B.', 'Chicago, IL'],
    ['Emma S.', 'Phoenix, AZ'],
    ['Liam D.', 'Atlanta, GA'],
    ['Ava C.', 'Portland, OR'],
    ['Lucas H.', 'Nashville, TN'],
    ['Mia W.', 'Boston, MA'],
    ['Daniel F.', 'Salt Lake City, UT'],
    ['Chloe G.', 'Raleigh, NC'],
    ['Tyler J.', 'Minneapolis, MN'],
    ['Zoe N.', 'Tampa, FL'],
    ['Ryan V.', 'Kansas City, MO'],
    ['Lily A.', 'Sacramento, CA'],
    ['Owen R.', 'Pittsburgh, PA'],
    ['Grace T.', 'Madison, WI'],
    ['Caleb M.', 'Tucson, AZ'],
    ['Ella B.', 'Richmond, VA'],
    ['Dylan S.', 'Boise, ID'],
    ['Aria K.', 'Omaha, NE'],
    ['Jordan L.', 'Albuquerque, NM'],
    ['Nora H.', 'Louisville, KY'],
    ['Evan P.', 'Charleston, SC'],
    ['Ruby C.', 'Spokane, WA'],
    ['Mason D.', 'Des Moines, IA'],
    ['Isla F.', 'Providence, RI'],
  ];

  var ACTIONS = [
    'just started a free trial',
    'just signed up',
    'just subscribed to Cheatly',
  ];

  var AVATAR_COLORS = ['#10b981', '#f59e0b', '#6366f1', '#ec4899', '#0ea5e9', '#8b5cf6'];

  var order = PEOPLE.map(function (_, i) { return i; });
  for (var i = order.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = order[i]; order[i] = order[j]; order[j] = tmp;
  }
  var idx = 0;

  var toast = document.createElement('div');
  toast.className = 'sp-toast';
  toast.setAttribute('role', 'status');
  toast.innerHTML =
    '<div class="sp-avatar"></div>' +
    '<div class="sp-body">' +
    '  <div class="sp-title"></div>' +
    '  <div class="sp-sub"></div>' +
    '</div>' +
    '<button class="sp-close" aria-label="Dismiss">&times;</button>';
  document.body.appendChild(toast);

  var avatarEl = toast.querySelector('.sp-avatar');
  var titleEl = toast.querySelector('.sp-title');
  var subEl = toast.querySelector('.sp-sub');
  var hideTimer = null;
  var nextTimer = null;

  toast.querySelector('.sp-close').addEventListener('click', function () {
    sessionStorage.setItem('cheatly_sp_dismissed', '1');
    clearTimeout(hideTimer);
    clearTimeout(nextTimer);
    toast.classList.remove('sp-visible');
  });

  function rand(min, max) {
    return min + Math.floor(Math.random() * (max - min + 1));
  }

  function show() {
    var person = PEOPLE[order[idx % order.length]];
    idx++;
    var name = person[0];
    var city = person[1];

    avatarEl.textContent = name.charAt(0);
    avatarEl.style.background = AVATAR_COLORS[rand(0, AVATAR_COLORS.length - 1)];
    titleEl.textContent = name + ' from ' + city;
    subEl.textContent =
      ACTIONS[rand(0, ACTIONS.length - 1)] + ' \u00b7 ' + rand(1, 19) + ' mins ago';

    toast.classList.add('sp-visible');
    hideTimer = setTimeout(function () {
      toast.classList.remove('sp-visible');
    }, 6000);
    nextTimer = setTimeout(show, rand(20000, 45000));
  }

  nextTimer = setTimeout(show, 8000);
})();
