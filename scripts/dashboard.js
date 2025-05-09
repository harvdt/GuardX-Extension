document.addEventListener("DOMContentLoaded", () => {
	const userInfoElement = document.getElementById("user-info");
	const logoutBtn = document.getElementById("logoutBtn");

	// Load user data and tokens from storage
	chrome.storage.local.get(
		["twitter_user_data", "twitter_refresh_token", "twitter_authenticated"],
		(result) => {
			// Check if access token exists in cookie
			const accessToken = chrome.storage.local.get("twitter_access_token")

			if (result.twitter_authenticated && result.twitter_user_data) {
				const userData = result.twitter_user_data;

				// Display user info
				userInfoElement.innerHTML = `
                <div>
                    <h3>Logged in as:</h3>
                    <p><strong>@${userData.twitter_username || "Unknown"}</strong></p>
								</div>
            `;
			} else {
				userInfoElement.innerHTML = `
                <div style="color: red;">
                    <p>Not logged in or session expired.</p>
                    <button id="goToLoginBtn">Go to Login</button>
                </div>
            `;

				document
					.getElementById("goToLoginBtn")
					.addEventListener("click", () => {
						window.location.href = "login.html";
					});
			}
		},
	);

	// Handle logout
	logoutBtn.addEventListener("click", () => {
		// Clear all authentication data
		chrome.storage.local.remove(
			[
				"twitter_authenticated",
				"twitter_user_data",
				"twitter_refresh_token",
				"twitter_cache_id",
			],
			() => {
				console.log("Local storage cleared");

				// Clear the cookie
				document.cookie = "twitter_access_token=; max-age=0; path=/";
				console.log("Cookie cleared");

				// Redirect to login page
				chrome.action.setPopup({ popup: "login.html" });
				window.location.href = "login.html";
			},
		);
	});
});
