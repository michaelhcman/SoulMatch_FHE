pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract SoulMatchFHE is ZamaEthereumConfig {
    struct EncryptedProfile {
        euint32 interests;
        euint32 values;
        uint256 publicPreferences;
        address owner;
        bool isActive;
        uint256 timestamp;
    }

    struct MatchResult {
        string matchId;
        uint256 score;
        bool mutual;
    }

    mapping(address => EncryptedProfile) private profiles;
    mapping(string => MatchResult) private matches;
    string[] private matchIds;

    event ProfileCreated(address indexed owner, uint256 timestamp);
    event ProfileUpdated(address indexed owner, uint256 timestamp);
    event MatchCalculated(string indexed matchId, address indexed user1, address indexed user2, uint256 score);
    event MatchConfirmed(string indexed matchId, bool mutual);

    constructor() ZamaEthereumConfig() {
    }

    function createProfile(
        externalEuint32 encryptedInterests,
        externalEuint32 encryptedValues,
        bytes calldata interestsProof,
        bytes calldata valuesProof,
        uint256 publicPreferences
    ) external {
        require(!profiles[msg.sender].isActive, "Profile already exists");

        euint32 interests = FHE.fromExternal(encryptedInterests, interestsProof);
        euint32 values = FHE.fromExternal(encryptedValues, valuesProof);

        require(FHE.isInitialized(interests), "Invalid interests encryption");
        require(FHE.isInitialized(values), "Invalid values encryption");

        profiles[msg.sender] = EncryptedProfile({
            interests: interests,
            values: values,
            publicPreferences: publicPreferences,
            owner: msg.sender,
            isActive: true,
            timestamp: block.timestamp
        });

        FHE.allowThis(profiles[msg.sender].interests);
        FHE.allowThis(profiles[msg.sender].values);

        emit ProfileCreated(msg.sender, block.timestamp);
    }

    function updateProfile(
        externalEuint32 encryptedInterests,
        externalEuint32 encryptedValues,
        bytes calldata interestsProof,
        bytes calldata valuesProof,
        uint256 publicPreferences
    ) external {
        require(profiles[msg.sender].isActive, "Profile does not exist");

        euint32 interests = FHE.fromExternal(encryptedInterests, interestsProof);
        euint32 values = FHE.fromExternal(encryptedValues, valuesProof);

        require(FHE.isInitialized(interests), "Invalid interests encryption");
        require(FHE.isInitialized(values), "Invalid values encryption");

        FHE.disallowThis(profiles[msg.sender].interests);
        FHE.disallowThis(profiles[msg.sender].values);

        profiles[msg.sender].interests = interests;
        profiles[msg.sender].values = values;
        profiles[msg.sender].publicPreferences = publicPreferences;
        profiles[msg.sender].timestamp = block.timestamp;

        FHE.allowThis(profiles[msg.sender].interests);
        FHE.allowThis(profiles[msg.sender].values);

        emit ProfileUpdated(msg.sender, block.timestamp);
    }

    function calculateMatchScore(address user1, address user2) external returns (string memory) {
        require(profiles[user1].isActive && profiles[user2].isActive, "Both profiles must be active");

        euint32 interestScore = FHE.add(
            FHE.mul(profiles[user1].interests, profiles[user2].interests),
            FHE.mul(profiles[user2].interests, profiles[user1].interests)
        );

        euint32 valueScore = FHE.add(
            FHE.mul(profiles[user1].values, profiles[user2].values),
            FHE.mul(profiles[user2].values, profiles[user1].values)
        );

        euint32 totalScore = FHE.add(interestScore, valueScore);

        string memory matchId = bytes32ToString(keccak256(abi.encodePacked(user1, user2)));

        matches[matchId] = MatchResult({
            matchId: matchId,
            score: FHE.decrypt(totalScore, 0),
            mutual: false
        });

        matchIds.push(matchId);

        emit MatchCalculated(matchId, user1, user2, matches[matchId].score);
        return matchId;
    }

    function confirmMatch(string calldata matchId) external {
        require(bytes(matches[matchId].matchId).length > 0, "Match does not exist");
        require(!matches[matchId].mutual, "Match already confirmed");

        matches[matchId].mutual = true;
        emit MatchConfirmed(matchId, true);
    }

    function getProfile(address user) external view returns (
        euint32 interests,
        euint32 values,
        uint256 publicPreferences,
        bool isActive
    ) {
        require(profiles[user].isActive, "Profile does not exist");
        return (
            profiles[user].interests,
            profiles[user].values,
            profiles[user].publicPreferences,
            profiles[user].isActive
        );
    }

    function getMatch(string calldata matchId) external view returns (
        string memory,
        uint256,
        bool
    ) {
        require(bytes(matches[matchId].matchId).length > 0, "Match does not exist");
        return (
            matches[matchId].matchId,
            matches[matchId].score,
            matches[matchId].mutual
        );
    }

    function getAllMatchIds() external view returns (string[] memory) {
        return matchIds;
    }

    function bytes32ToString(bytes32 data) private pure returns (string memory) {
        uint256 length = 0;
        while (length < 32 && data[length] != 0) {
            length++;
        }
        bytes memory result = new bytes(length);
        for (uint256 i = 0; i < length; i++) {
            result[i] = data[i];
        }
        return string(result);
    }
}


