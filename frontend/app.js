let socket = null;

let currentUser = null;

let currentConversationId = null;

let currentFriend = null;

let typingTimer = null;


/* =================================
   ELEMENTS
================================= */

const authScreen =
    document.getElementById("authScreen");

const appScreen =
    document.getElementById("appScreen");

const authMessage =
    document.getElementById("authMessage");

const loginForm =
    document.getElementById("loginForm");

const registerForm =
    document.getElementById("registerForm");

const logoutButton =
    document.getElementById("logoutButton");

const currentVishId =
    document.getElementById("currentVishId");

const moodSelect =
    document.getElementById("moodSelect");

const searchInput =
    document.getElementById("searchInput");

const searchButton =
    document.getElementById("searchButton");

const searchResults =
    document.getElementById("searchResults");

const friendRequests =
    document.getElementById("friendRequests");

const friendsList =
    document.getElementById("friendsList");

const friendPlanets =
    document.getElementById("friendPlanets");

const chatPanel =
    document.getElementById("chatPanel");

const closeChatButton =
    document.getElementById("closeChatButton");

const chatFriendName =
    document.getElementById("chatFriendName");

const chatFriendVishId =
    document.getElementById("chatFriendVishId");

const messages =
    document.getElementById("messages");

const messageForm =
    document.getElementById("messageForm");

const messageInput =
    document.getElementById("messageInput");

const typingIndicator =
    document.getElementById("typingIndicator");

const toast =
    document.getElementById("toast");


/* =================================
   API
================================= */

async function api(
    url,
    options = {}
) {
    const response =
        await fetch(url, {
            credentials: "include",

            headers: {
                "Content-Type":
                    "application/json",

                ...(options.headers || {})
            },

            ...options
        });


    let data = {};

    try {
        data = await response.json();
    } catch {
        data = {};
    }


    if (!response.ok) {
        throw new Error(
            data.error ||
            "Something went wrong."
        );
    }


    return data;
}


/* =================================
   UI
================================= */

function showAuth() {
    authScreen.classList.remove("hidden");

    appScreen.classList.add("hidden");
}


function showApp() {
    authScreen.classList.add("hidden");

    appScreen.classList.remove("hidden");
}


function showAuthMessage(message) {
    authMessage.textContent = message;
}


function showToast(message) {
    toast.textContent = message;

    toast.classList.add("show");

    setTimeout(() => {
        toast.classList.remove("show");
    }, 2500);
}


/* =================================
   LOGIN
================================= */

loginForm.addEventListener(
    "submit",
    async (event) => {
        event.preventDefault();

        showAuthMessage("");


        const vishId =
            document
                .getElementById("loginVishId")
                .value;

        const password =
            document
                .getElementById("loginPassword")
                .value;


        try {
            const data =
                await api(
                    "/api/auth/login",
                    {
                        method: "POST",

                        body: JSON.stringify({
                            vishId,
                            password
                        })
                    }
                );


            currentUser = data.user;

            await startApp();

        } catch (error) {
            showAuthMessage(
                error.message
            );
        }
    }
);


/* =================================
   REGISTER
================================= */

registerForm.addEventListener(
    "submit",
    async (event) => {
        event.preventDefault();

        showAuthMessage("");


        const vishId =
            document
                .getElementById("registerVishId")
                .value;

        const displayName =
            document
                .getElementById("registerDisplayName")
                .value;

        const password =
            document
                .getElementById("registerPassword")
                .value;


        try {
            const data =
                await api(
                    "/api/auth/register",
                    {
                        method: "POST",

                        body: JSON.stringify({
                            vishId,
                            displayName,
                            password
                        })
                    }
                );


            currentUser = data.user;

            await startApp();

        } catch (error) {
            showAuthMessage(
                error.message
            );
        }
    }
);


/* =================================
   LOGOUT
================================= */

logoutButton.addEventListener(
    "click",
    async () => {
        try {
            await api(
                "/api/auth/logout",
                {
                    method: "POST"
                }
            );
        } catch {
            // Continue local logout.
        }


        if (socket) {
            socket.disconnect();

            socket = null;
        }


        currentUser = null;

        currentConversationId = null;

        currentFriend = null;


        showAuth();
    }
);


/* =================================
   START APP
================================= */

async function startApp() {
    showApp();


    currentVishId.textContent =
        `@${currentUser.vish_id}`;


    moodSelect.value =
        currentUser.mood;


    connectSocket();


    await Promise.all([
        loadFriends(),
        loadFriendRequests()
    ]);


    renderGalaxy();
}


/* =================================
   CHECK SESSION
================================= */

async function checkSession() {
    try {
        const data =
            await api("/api/me");

        currentUser = data.user;

        await startApp();

    } catch {
        showAuth();
    }
}


/* =================================
   SOCKET
================================= */

function connectSocket() {
    if (socket) {
        socket.disconnect();
    }


    socket = io({
        withCredentials: true
    });


    socket.on(
        "connect",
        () => {
            console.log(
                "VISH realtime connected"
            );
        }
    );


    socket.on(
        "message:new",
        (message) => {
            if (
                message.conversation_id ===
                currentConversationId
            ) {
                renderMessage(message);

                scrollMessages();
            }
        }
    );


    socket.on(
        "typing",
        (data) => {
            if (
                data.userId !==
                currentUser.id
            ) {
                typingIndicator.textContent =
                    data.typing
                        ? "typing..."
                        : "";
            }
        }
    );


    socket.on(
        "friend:request",
        async () => {
            showToast(
                "New friend request ✨"
            );

            await loadFriendRequests();
        }
    );


    socket.on(
        "friend:accepted",
        async () => {
            showToast(
                "Friend added to your galaxy ✨"
            );

            await loadFriends();

            renderGalaxy();
        }
    );


    socket.on(
        "user:mood",
        (data) => {
            renderGalaxy();
        }
    );
}


/* =================================
   MOOD
================================= */

moodSelect.addEventListener(
    "change",
    async () => {
        try {
            const data =
                await api(
                    "/api/me/mood",
                    {
                        method: "PATCH",

                        body: JSON.stringify({
                            mood:
                                moodSelect.value
                        })
                    }
                );


            currentUser =
                data.user;


            updateGalaxyMood();

        } catch (error) {
            showToast(
                error.message
            );
        }
    }
);


/* =================================
   SEARCH
================================= */

searchButton.addEventListener(
    "click",
    searchUsers
);


searchInput.addEventListener(
    "keydown",
    (event) => {
        if (
            event.key === "Enter"
        ) {
            event.preventDefault();

            searchUsers();
        }
    }
);


async function searchUsers() {
    const query =
        searchInput.value.trim();


    if (query.length < 2) {
        searchResults.innerHTML =
            "<small>Type a VISH ID.</small>";

        return;
    }


    try {
        const data =
            await api(
                `/api/users/search?q=${encodeURIComponent(query)}`
            );


        searchResults.innerHTML = "";


        if (
            data.users.length === 0
        ) {
            searchResults.innerHTML =
                "<small>No VISH found.</small>";

            return;
        }


        data.users.forEach(
            (user) => {
                const item =
                    document.createElement(
                        "div"
                    );

                item.className =
                    "result-item";


                const info =
                    document.createElement(
                        "div"
                    );


                info.innerHTML = `
                    <div class="result-name">
                        ${escapeHtml(
                            user.display_name
                        )}
                    </div>

                    <div class="result-vish">
                        @${escapeHtml(
                            user.vish_id
                        )}
                    </div>
                `;


                const button =
                    document.createElement(
                        "button"
                    );


                button.className =
                    "result-button";

                button.textContent =
                    "Add";


                button.addEventListener(
                    "click",
                    async () => {
                        await sendFriendRequest(
                            user.vish_id
                        );
                    }
                );


                item.appendChild(info);

                item.appendChild(button);

                searchResults.appendChild(
                    item
                );
            }
        );

    } catch (error) {
        showToast(
            error.message
        );
    }
}


/* =================================
   FRIEND REQUEST
================================= */

async function sendFriendRequest(
    vishId
) {
    try {
        await api(
            "/api/friends/request",
            {
                method: "POST",

                body: JSON.stringify({
                    vishId
                })
            }
        );


        showToast(
            "Friend request launched 🚀"
        );

    } catch (error) {
        showToast(
            error.message
        );
    }
}


/* =================================
   FRIEND REQUESTS
================================= */

async function loadFriendRequests() {
    try {
        const data =
            await api(
                "/api/friends/requests"
            );


        friendRequests.innerHTML = "";


        if (
            data.requests.length === 0
        ) {
            friendRequests.innerHTML =
                "<small>No pending requests.</small>";

            return;
        }


        data.requests.forEach(
            (request) => {
                const item =
                    document.createElement(
                        "div"
                    );

                item.className =
                    "result-item";


                const info =
                    document.createElement(
                        "div"
                    );


                info.innerHTML = `
                    <div class="result-name">
                        ${escapeHtml(
                            request.display_name
                        )}
                    </div>

                    <div class="result-vish">
                        @${escapeHtml(
                            request.vish_id
                        )}
                    </div>
                `;


                const button =
                    document.createElement(
                        "button"
                    );


                button.className =
                    "result-button";

                button.textContent =
                    "Accept";


                button.addEventListener(
                    "click",
                    async () => {
                        await acceptRequest(
                            request.id
                        );
                    }
                );


                item.appendChild(info);

                item.appendChild(button);

                friendRequests.appendChild(
                    item
                );
            }
        );

    } catch (error) {
        console.error(error);
    }
}


async function acceptRequest(
    requestId
) {
    try {
        await api(
            `/api/friends/requests/${requestId}/accept`,
            {
                method: "POST"
            }
        );


        await loadFriendRequests();

        await loadFriends();

        renderGalaxy();

        showToast(
            "Friend joined your galaxy ✨"
        );

    } catch (error) {
        showToast(
            error.message
        );
    }
}


/* =================================
   FRIENDS
================================= */

let friends = [];


async function loadFriends() {
    try {
        const data =
            await api(
                "/api/friends"
            );


        friends =
            data.friends || [];


        renderFriends();

        renderGalaxy();

    } catch (error) {
        console.error(error);
    }
}


function renderFriends() {
    friendsList.innerHTML = "";


    if (friends.length === 0) {
        friendsList.innerHTML =
            "<small>Your galaxy is waiting for people.</small>";

        return;
    }


    friends.forEach(
        (friend) => {
            const item =
                document.createElement(
                    "div"
                );

            item.className =
                "result-item";


            const info =
                document.createElement(
                    "div"
                );


            info.innerHTML = `
                <div class="result-name">
                    ${escapeHtml(
                        friend.display_name
                    )}
                </div>

                <div class="result-vish">
                    @${escapeHtml(
                        friend.vish_id
                    )}
                </div>
            `;


            const button =
                document.createElement(
                    "button"
                );


            button.className =
                "result-button";

            button.textContent =
                "Chat";


            button.addEventListener(
                "click",
                () => {
                    openChat(friend);
                }
            );


            item.appendChild(info);

            item.appendChild(button);

            friendsList.appendChild(
                item
            );
        }
    );
}


/* =================================
   GALAXY
================================= */

function renderGalaxy() {
    friendPlanets.innerHTML = "";


    const positions = [
        [20, 25],
        [75, 22],
        [25, 70],
        [75, 68],
        [50, 15],
        [50, 85],
        [12, 50],
        [88, 50]
    ];


    friends
        .slice(0, positions.length)
        .forEach(
            (friend, index) => {
                const planet =
                    document.createElement(
                        "button"
                    );


                planet.className =
                    "planet";


                const [
                    left,
                    top
                ] =
                    positions[index];


                planet.style.left =
                    `${left}%`;

                planet.style.top =
                    `${top}%`;


                planet.innerHTML = `
                    ✦
                    <span>
                        ${escapeHtml(
                            friend.display_name
                        )}
                    </span>
                `;


                planet.title =
                    `@${friend.vish_id}`;


                planet.addEventListener(
                    "click",
                    () => {
                        openChat(friend);
                    }
                );


                friendPlanets.appendChild(
                    planet
                );
            }
        );


    updateGalaxyMood();
}


function updateGalaxyMood() {
    const mood =
        currentUser?.mood || "calm";


    const galaxy =
        document.getElementById(
            "galaxy"
        );


    const backgrounds = {
        calm:
            "radial-gradient(circle at center, rgba(60,100,255,.22), transparent 30%), #040719",

        happy:
            "radial-gradient(circle at center, rgba(255,205,60,.22), transparent 30%), #120d18",

        low:
            "radial-gradient(circle at center, rgba(90,50,150,.20), transparent 30%), #080615",

        angry:
            "radial-gradient(circle at center, rgba(255,70,70,.20), transparent 30%), #140707",

        love:
            "radial-gradient(circle at center, rgba(255,80,150,.20), transparent 30%), #140713",

        excited:
            "radial-gradient(circle at center, rgba(60,230,255,.25), transparent 30%), #03121a"
    };


    galaxy.style.background =
        backgrounds[mood] ||
        backgrounds.calm;
}


/* =================================
   OPEN CHAT
================================= */

async function openChat(friend) {
    try {
        const data =
            await api(
                "/api/conversations",
                {
                    method: "POST",

                    body: JSON.stringify({
                        friendId:
                            friend.id
                    })
                }
            );


        currentConversationId =
            data.conversationId;

        currentFriend =
            friend;


        chatFriendName.textContent =
            friend.display_name;


        chatFriendVishId.textContent =
            `@${friend.vish_id}`;


        chatPanel.classList.remove(
            "hidden"
        );


        messages.innerHTML = "";


        if (socket) {
            socket.emit(
                "conversation:join",
                currentConversationId,
                () => {}
            );
        }


        const messageData =
            await api(
                `/api/conversations/${currentConversationId}/messages`
            );


        messageData.messages.forEach(
            renderMessage
        );


        scrollMessages();


        messageInput.focus();

    } catch (error) {
        showToast(
            error.message
        );
    }
}


/* =================================
   CLOSE CHAT
================================= */

closeChatButton.addEventListener(
    "click",
    () => {
        chatPanel.classList.add(
            "hidden"
        );

        currentConversationId = null;

        currentFriend = null;

        messages.innerHTML = "";
    }
);


/* =================================
   SEND MESSAGE
================================= */

messageForm.addEventListener(
    "submit",
    (event) => {
        event.preventDefault();


        if (
            !socket ||
            !currentConversationId
        ) {
            return;
        }


        const content =
            messageInput.value.trim();


        if (!content) {
            return;
        }


        socket.emit(
            "message:send",
            {
                conversationId:
                    currentConversationId,

                content,

                messageType:
                    "text"
            },
            (result) => {
                if (!result?.ok) {
                    showToast(
                        result?.error ||
                        "Unable to send."
                    );

                    return;
                }


                messageInput.value = "";

                typingIndicator.textContent =
                    "";
            }
        );
    }
);


/* =================================
   TYPING
================================= */

messageInput.addEventListener(
    "input",
    () => {
        if (
            !socket ||
            !currentConversationId
        ) {
            return;
        }


        socket.emit(
            "typing",
            {
                conversationId:
                    currentConversationId,

                typing: true
            }
        );


        clearTimeout(
            typingTimer
        );


        typingTimer =
            setTimeout(
                () => {
                    socket.emit(
                        "typing",
                        {
                            conversationId:
                                currentConversationId,

                            typing: false
                        }
                    );
                },
                800
            );
    }
);


/* =================================
   RENDER MESSAGE
================================= */

function renderMessage(message) {
    const bubble =
        document.createElement(
            "div"
        );


    const mine =
        message.sender_id ===
        currentUser.id;


    bubble.className =
        `message-bubble ${
            mine ? "mine" : ""
        }`;


    const text =
        document.createElement(
            "div"
        );


    text.textContent =
        message.content;


    const time =
        document.createElement(
            "span"
        );


    time.className =
        "message-time";


    time.textContent =
        formatTime(
            message.created_at
        );


    bubble.appendChild(text);

    bubble.appendChild(time);

    messages.appendChild(bubble);
}


function scrollMessages() {
    messages.scrollTop =
        messages.scrollHeight;
}


/* =================================
   TIME
================================= */

function formatTime(
    date
) {
    return new Date(date)
        .toLocaleTimeString(
            [],
            {
                hour: "2-digit",
                minute: "2-digit"
            }
        );
}


/* =================================
   ESCAPE HTML
================================= */

function escapeHtml(value) {
    const div =
        document.createElement(
            "div"
        );

    div.textContent =
        value;

    return div.innerHTML;
}


/* =================================
   START
================================= */

checkSession();
