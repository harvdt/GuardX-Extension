// tokenHelper.js - Utility functions for managing access and refresh tokens

// Function to set access token in cookie
function setAccessTokenCookie(token, expiresInSeconds = 7200) {
	// Calculate expiry date
	const expiryDate = new Date();
	expiryDate.setTime(expiryDate.getTime() + expiresInSeconds * 1000);

	// Set cookie with secure options
	document.cookie = `twitter_access_token=${token}; path=/; expires=${expiryDate.toUTCString()}; SameSite=Lax`;
}

// Function to get access token from cookie
function getAccessTokenFromCookie() {
	const cookies = document.cookie.split(";");
	for (let i = 0; i < cookies.length; i++) {
		const cookie = cookies[i].trim();
		if (cookie.startsWith("twitter_access_token=")) {
			return cookie.substring("twitter_access_token=".length);
		}
	}
	return null;
}

// Function to delete access token cookie
function deleteAccessTokenCookie() {
	document.cookie =
		"twitter_access_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax";
}

// Function to store refresh token in chrome.storage.local
function storeRefreshToken(refreshToken) {
	return new Promise((resolve) => {
		chrome.storage.local.set({ twitter_refresh_token: refreshToken }, () => {
			resolve();
		});
	});
}

// Function to get refresh token from chrome.storage.local
function getRefreshToken() {
	return new Promise((resolve) => {
		chrome.storage.local.get(["twitter_refresh_token"], (result) => {
			resolve(result.twitter_refresh_token || null);
		});
	});
}

// Function to delete refresh token from chrome.storage.local
function deleteRefreshToken() {
	return new Promise((resolve) => {
		chrome.storage.local.remove(["twitter_refresh_token"], () => {
			resolve();
		});
	});
}

// Function to check if tokens exist and are valid
async function checkTokens() {
	const accessToken = getAccessTokenFromCookie();
	const refreshToken = await getRefreshToken();

	return {
		hasAccessToken: !!accessToken,
		hasRefreshToken: !!refreshToken,
		accessToken,
		refreshToken,
	};
}

// Export these functions for use in other scripts
// Note: In a Chrome extension context, you'll need to import this file in HTML before scripts that use it
window.tokenHelper = {
	setAccessTokenCookie,
	getAccessTokenFromCookie,
	deleteAccessTokenCookie,
	storeRefreshToken,
	getRefreshToken,
	deleteRefreshToken,
	checkTokens,
};
